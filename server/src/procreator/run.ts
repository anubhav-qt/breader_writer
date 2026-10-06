import { runAgentLoop, type AgentContext, type AgentEvent, type AgentLoopConfig, type AgentMessage, type AgentTool } from '@writer/pi-agent';
import {
  estimateContextTokens,
  estimateMessageTokens,
  streamSimple,
  toToolDeclaration,
  type AssistantMessage,
  type Message,
  type StopReason,
  type SystemMessage,
  type ThinkingLevel,
  type UserMessage,
} from '@writer/pi-ai';
import type { Catalog } from '../ai/catalog.ts';
import { ModelError, recordCall, textOf, type CallTag, type Role, type Sent } from '../ai/call.ts';
import type { InUse } from '../ai/settings.ts';
import type { Db } from '../db/client.ts';
import { log } from '../log.ts';
import type { Scene } from '../story/scenes.ts';
import { addMessage, segmentMessages, type MessageKind, type Segment } from '../story/session.ts';
import { instructionsFor } from './brief.ts';
import { memoryTools } from './tools.ts';

/*
 * One exchange in a scene's session: the session sent as it stands (Procreator's instructions and
 * tools, the segment's head, then its messages) with one more message, and Procreator's answer,
 * with as many rounds of tool calls as it takes. Everything is kept as it comes back, so the next
 * call starts with exactly what this one sent and got: the provider's cache holds, and Gemini's
 * thought signatures go back with their turns.
 */

/** What running Procreator needs: the database, and the model and account it runs on. */
export interface Procreator {
  db: Db;
  catalog: Catalog;
  inUse: InUse;
  userId: string;
  signal?: AbortSignal;
}

/** One message to Procreator in a scene's session. */
export interface Ask {
  text: string;
  /** play for the story; fold for a compaction or a wrap-up, whose messages are never sent again. */
  kind: Exclude<MessageKind, 'note'>;
  role: Role;
  /** The turn it's sent at, which its messages and changes are tagged with. */
  turnId: string | null;
}

export interface Answer {
  /** Procreator's last words, without its thinking or tool calls. */
  text: string;
  /** stop when it finished, length when it ran out of room, toolUse when it was stopped mid work. */
  stopReason: StopReason;
}

/** A long answer is fine, a stuck one isn't. */
const TIMEOUT_MS = 5 * 60_000;
/** The most calls one message can take: an answer and its tool calls, round after round. */
const MAX_CALLS = 24;

/** The session as the model is sent it: the instructions and tools, the segment's head, then its messages. */
export async function sessionContext(db: Db, scene: Scene, segment: Segment, tools: AgentTool[]): Promise<AgentContext> {
  const instructions = await instructionsFor(db, scene.bookId);
  const system: SystemMessage = {
    role: 'system',
    content: instructions,
    toolsAdded: tools.map(toToolDeclaration),
    timestamp: 0,
  };
  const head: UserMessage = { role: 'user', content: segment.head, timestamp: segment.createdAt.getTime() };
  const messages: Message[] = [system, head];
  const kept = await segmentMessages(db, segment);
  for (const each of kept) {
    messages.push(each.message);
  }
  return { messages, tools };
}

/**
 * The tokens a session takes: what the model last said it read, and an estimate of what came since.
 * A head newer than that call (after a compaction) makes it an estimate throughout.
 */
export function sessionTokens(messages: Message[]): number {
  return estimateContextTokens(messages).tokens;
}

/** The tokens in what's about to be sent, as the writer counts them. */
function counted(messages: AgentMessage[]): number {
  let tokens = 0;
  for (const message of messages) {
    tokens += estimateMessageTokens(message as Message);
  }
  return tokens;
}

function thinkingOf(inUse: InUse): ThinkingLevel | undefined {
  const level = inUse.choice.thinking;
  if (level === 'off') {
    return undefined;
  }
  return level;
}

/** Keeps a run as it goes: each message in the session, and each call in calls. */
class Keeper {
  /** Model calls so far. */
  calls = 0;
  /** Procreator's latest message. */
  last: AssistantMessage | null = null;
  private sent: Sent | null = null;
  private readonly ai: Procreator;
  private readonly scene: Scene;
  private readonly ask: Ask;

  constructor(ai: Procreator, scene: Scene, ask: Ask) {
    this.ai = ai;
    this.scene = scene;
    this.ask = ask;
  }

  /** A call is about to go: when, and what it holds. */
  sending(messages: AgentMessage[]) {
    this.sent = { startedAt: new Date(), estimate: counted(messages) };
  }

  async keep(event: AgentEvent) {
    if (event.type !== 'message_end') {
      return;
    }
    const message = event.message as Message;
    if (message.role === 'system') {
      return;
    }
    await addMessage(this.ai.db, this.scene, this.ask.kind, this.ask.turnId, message);
    if (message.role === 'assistant') {
      this.calls += 1;
      this.last = message;
      await this.record(message);
    }
  }

  private async record(message: AssistantMessage) {
    const tag: CallTag = {
      userId: this.ai.userId,
      bookId: this.scene.bookId,
      sceneId: this.scene.id,
      turnId: this.ask.turnId,
      role: this.ask.role,
    };
    const sent = this.sent ?? { startedAt: new Date(), estimate: 0 };
    await recordCall(this.ai.db, tag, this.ai.inUse, sent, message);
  }
}

/** Sends one message in the scene's session as the segment stands, and keeps everything that comes back. */
export async function exchange(ai: Procreator, scene: Scene, segment: Segment, ask: Ask): Promise<Answer> {
  const tools = memoryTools({ db: ai.db, scene, turnId: ask.turnId });
  const context = await sessionContext(ai.db, scene, segment, tools);
  const prompt: UserMessage = { role: 'user', content: ask.text, timestamp: Date.now() };
  const keeper = new Keeper(ai, scene, ask);
  const config: AgentLoopConfig = {
    model: ai.inUse.model,
    reasoning: thinkingOf(ai.inUse),
    apiKey: ai.catalog.proxy.apiKey,
    // Keeps a session's calls on one cache where the provider keys its cache by session.
    sessionId: scene.id,
    timeoutMs: TIMEOUT_MS,
    // One write at a time, in the order asked, so changes land as Procreator meant them.
    toolExecution: 'sequential',
    convertToLlm: (messages) => messages as Message[],
    prepareRequest: (request) => {
      keeper.sending(request.context.messages);
    },
    finishTurn: () => {
      if (keeper.calls >= MAX_CALLS) {
        log.warn({ sceneId: scene.id, calls: keeper.calls }, 'Procreator was stopped after too many calls for one message');
        return { action: 'end' };
      }
      return undefined;
    },
  };
  await runAgentLoop([prompt], context, config, (event) => keeper.keep(event), ai.signal, streamSimple);

  const last = keeper.last;
  if (!last) {
    throw new ModelError('The model didn’t answer.');
  }
  if (last.stopReason === 'error' || last.stopReason === 'aborted') {
    throw new ModelError(last.errorMessage ?? 'The model didn’t answer.');
  }
  return { text: textOf(last).trim(), stopReason: last.stopReason };
}
