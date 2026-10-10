import type { AgentMessage } from '@writer/pi-agent';
import { estimateMessageTokens, type AssistantMessage, type Message, type ThinkingLevel } from '@writer/pi-ai';
import type { Db } from '../db/client.ts';
import { calls } from '../db/schema.ts';
import type { InUse } from './settings.ts';

/*
 * Calls to the model, as the writer keeps account of them. Every call goes in `calls`, with the
 * tokens the writer counted before sending it and what the model says it used (cache reads
 * included), so the budget and the cache can be seen.
 */

/**
 * What the model is asked to do. actor is a cast member's actor answering a cue; openings are the
 * first scene's, offered to pick from; setup is the help with setup: suggestions and the
 * Suggestions chat.
 */
export type Role = 'narrator' | 'actor' | 'author' | 'hints' | 'openings' | 'fold' | 'rewrite' | 'setup';

/** A model call that came back with no answer: the proxy down, an account out of its limits. */
export class ModelError extends Error {}

/** Where a call was made, for its record. */
export interface CallTag {
  /** The account whose model it runs on. */
  userId: string;
  bookId: string | null;
  sceneId: string | null;
  turnId: string | null;
  role: Role;
}

/** One call, as it was sent: when, and the tokens the writer counted in it. */
export interface Sent {
  startedAt: Date;
  estimate: number;
}

/** The tokens in what's about to be sent, as the writer counts them. */
export function counted(messages: AgentMessage[]): number {
  let tokens = 0;
  for (const message of messages) {
    tokens += estimateMessageTokens(message as Message);
  }
  return tokens;
}

/** How hard the model is asked to think: the account's level, or nothing when it's off. */
export function thinkingOf(inUse: InUse): ThinkingLevel | undefined {
  const level = inUse.choice.thinking;
  if (level === 'off') {
    return undefined;
  }
  return level;
}

/** Records a call and what came back. */
export async function recordCall(db: Db, tag: CallTag, inUse: InUse, sent: Sent, message: AssistantMessage) {
  await db.insert(calls).values({
    userId: tag.userId,
    bookId: tag.bookId,
    sceneId: tag.sceneId,
    turnId: tag.turnId,
    role: tag.role,
    model: inUse.choice.model,
    thinking: inUse.choice.thinking,
    estimate: sent.estimate,
    input: message.usage.input,
    output: message.usage.output,
    cacheRead: message.usage.cacheRead,
    cacheWrite: message.usage.cacheWrite,
    stopReason: message.stopReason,
    error: message.errorMessage ?? null,
    startedAt: sent.startedAt,
    endedAt: new Date(),
  });
}

/** A reply's text, without its thinking or tool calls. */
export function textOf(message: AssistantMessage): string {
  const parts: string[] = [];
  for (const block of message.content) {
    if (block.type === 'text') {
      parts.push(block.text);
    }
  }
  return parts.join('');
}
