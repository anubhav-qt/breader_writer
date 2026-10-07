import { runAgentLoop, type AgentContext, type AgentEvent, type AgentLoopConfig, type AgentMessage, type AgentTool } from '@writer/pi-agent';
import {
  estimateContextTokens,
  streamSimple,
  toToolDeclaration,
  type AssistantMessage,
  type Message,
  type StopReason,
  type SystemMessage,
  type UserMessage,
} from '@writer/pi-ai';
import type { Catalog } from '../ai/catalog.ts';
import { counted, ModelError, recordCall, textOf, thinkingOf, type CallTag, type Role, type Sent } from '../ai/call.ts';
import { undashed, Undasher } from '../ai/dashes.ts';
import type { InUse } from '../ai/settings.ts';
import type { Db } from '../db/client.ts';
import type { Scene } from '../story/scenes.ts';
import { addMessage, segmentMessages, type MessageKind, type Segment } from '../story/session.ts';
import { instructionsFor } from './brief.ts';
import { noOutcome, stopped, toolsFor, type Outcome } from './play.ts';
import type { Mode } from './tools.ts';

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
  /**
   * play for the story; fold for a compaction or a wrap-up, and aside for openings or hints asked
   * for, whose messages are never sent again.
   */
  kind: Exclude<MessageKind, 'note'>;
  role: Role;
  /** The turn it's sent at, which its messages and changes are tagged with. */
  turnId: string | null;
  /** What the run is for, which says what its tools may do. */
  mode: Mode;
  /** The owner plays others too: a cue stops the turn for them to say who plays the one about to act. */
  playOthers?: boolean;
  /** Procreator's words as they come, without dashes. */
  onText?: (delta: string) => void;
  /** Where and when the scene is, whenever set_scene changes it. */
  onScene?: (scene: Scene) => void;
}

export interface Answer {
  /** Procreator's last words, without its thinking or tool calls. */
  text: string;
  /** Everything it wrote in the run, reply after reply, without dashes: a turn's narration. */
  words: string;
  /** stop when it finished, length when it ran out of room, toolUse when it was stopped mid work. */
  stopReason: StopReason;
  /** What its play tools did. */
  outcome: Outcome;
}

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

/** Keeps a run as it goes: each message in the session, each call in calls, and Procreator's words. */
class Keeper {
  /** Procreator's latest message. */
  last: AssistantMessage | null = null;
  private sent: Sent | null = null;
  /** The words of each of Procreator's replies so far. */
  private readonly texts: string[] = [];
  /** Whether the reply being written has passed any words on yet. */
  private started = false;
  private readonly undasher = new Undasher();
  private readonly ai: Procreator;
  private readonly scene: Scene;
  private readonly ask: Ask;

  constructor(ai: Procreator, scene: Scene, ask: Ask) {
    this.ai = ai;
    this.scene = scene;
    this.ask = ask;
  }

  /** A call is about to go: when, and what it holds. Its reply's words go after a blank line. */
  sending(messages: AgentMessage[]) {
    this.sent = { startedAt: new Date(), estimate: counted(messages) };
    this.started = false;
  }

  async keep(event: AgentEvent) {
    if (event.type === 'message_update') {
      const update = event.assistantMessageEvent;
      if (update.type === 'text_delta') {
        this.pass(this.undasher.push(update.delta));
      }
      return;
    }
    if (event.type !== 'message_end') {
      return;
    }
    const message = event.message as Message;
    if (message.role === 'system') {
      return;
    }
    await addMessage(this.ai.db, this.scene, this.ask.kind, this.ask.turnId, message);
    if (message.role === 'assistant') {
      this.last = message;
      this.pass(this.undasher.flush());
      const text = undashed(textOf(message).trim());
      if (text !== '') {
        this.texts.push(text);
      }
      await this.record(message);
    }
  }

  /** Passes words of the reply being written on, a blank line between one reply and the next. */
  private pass(words: string) {
    if (words === '' || !this.ask.onText) {
      return;
    }
    if (!this.started && this.texts.length > 0) {
      this.ask.onText('\n\n');
    }
    this.started = true;
    this.ask.onText(words);
  }

  /** Everything Procreator wrote in the run. */
  words(): string {
    return this.texts.join('\n\n');
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
  const outcome = noOutcome();
  const onScene = ask.onScene ?? (() => {});
  const playOthers = ask.playOthers ?? false;
  const tools = toolsFor({ ai, db: ai.db, scene, turnId: ask.turnId, mode: ask.mode, playOthers, outcome, onScene });
  const context = await sessionContext(ai.db, scene, segment, tools);
  const prompt: UserMessage = { role: 'user', content: ask.text, timestamp: Date.now() };
  const keeper = new Keeper(ai, scene, ask);
  // No cap on calls or time: Procreator takes as many rounds as the work needs, since the owner
  // wants the best writing over the cheapest. A run that's stuck is stopped by hand, through the signal.
  const config: AgentLoopConfig = {
    model: ai.inUse.model,
    reasoning: thinkingOf(ai.inUse),
    apiKey: ai.catalog.proxy.apiKey,
    // Keeps a session's calls on one cache where the provider keys its cache by session.
    sessionId: scene.id,
    // The owner often takes longer than five minutes over a move, so the cache is asked to last:
    // an hour on Claude (a write costs a little more, every read far less). Gemini caches by itself.
    cacheRetention: 'long',
    // One write at a time, in the order asked, so changes land as Procreator meant them.
    toolExecution: 'sequential',
    convertToLlm: (messages) => messages as Message[],
    prepareRequest: (request) => {
      keeper.sending(request.context.messages);
    },
    // A scene that ended, or a cue the owner answers, stops the run even when other tool calls
    // came with it, so Procreator writes nothing past it.
    finishTurn: () => {
      if (stopped(outcome)) {
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
  return { text: textOf(last).trim(), words: keeper.words(), stopReason: last.stopReason, outcome };
}
