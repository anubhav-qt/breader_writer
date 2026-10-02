import { estimateTextTokens, normalizeContext, streamSimple, type AssistantMessage, type StopReason } from '@writer/pi-ai';
import type { Db } from '../db/client.ts';
import { calls } from '../db/schema.ts';
import type { Catalog } from './catalog.ts';
import type { InUse } from './settings.ts';

/*
 * One call to a model through the shared proxy: the instructions and one message, rebuilt from
 * the story for every call, and the reply's text. Every call is recorded with the tokens the
 * writer counted before sending it and what the model says it used, so the budget can be seen.
 */

/** What the model is asked to do. */
export type Role = 'narrator' | 'author' | 'hints' | 'fold';

export interface Ask {
  /** The account whose model it runs on. */
  userId: string;
  bookId: string | null;
  sceneId?: string | null;
  turnId?: string | null;
  role: Role;
  system: string;
  user: string;
  signal?: AbortSignal;
}

export interface Answer {
  text: string;
  /** stop when the model finished, length when it ran out of room. */
  stopReason: StopReason;
}

/** A model call that came back with no answer: the proxy down, an account out of its limits. */
export class ModelError extends Error {}

/** A long call is fine, a stuck one isn't. */
const TIMEOUT_MS = 5 * 60_000;

function textOf(message: AssistantMessage): string {
  const parts: string[] = [];
  for (const block of message.content) {
    if (block.type === 'text') {
      parts.push(block.text);
    }
  }
  return parts.join('');
}

async function record(db: Db, request: Ask, inUse: InUse, estimate: number, startedAt: Date, message: AssistantMessage) {
  await db.insert(calls).values({
    userId: request.userId,
    bookId: request.bookId,
    sceneId: request.sceneId ?? null,
    turnId: request.turnId ?? null,
    role: request.role,
    model: inUse.choice.model,
    thinking: inUse.choice.thinking,
    estimate,
    input: message.usage.input,
    output: message.usage.output,
    cacheRead: message.usage.cacheRead,
    cacheWrite: message.usage.cacheWrite,
    stopReason: message.stopReason,
    error: message.errorMessage ?? null,
    startedAt,
    endedAt: new Date(),
  });
}

/** Asks the model in use, records the call, and gives back its answer. */
export async function ask(db: Db, catalog: Catalog, inUse: InUse, request: Ask): Promise<Answer> {
  const context = normalizeContext({
    systemPrompt: request.system,
    messages: [{ role: 'user', content: request.user, timestamp: Date.now() }],
  });
  const estimate = estimateTextTokens(request.system) + estimateTextTokens(request.user);
  let reasoning = undefined;
  if (inUse.choice.thinking !== 'off') {
    reasoning = inUse.choice.thinking;
  }

  const startedAt = new Date();
  const stream = streamSimple(inUse.model, context, {
    apiKey: catalog.proxy.apiKey,
    reasoning,
    signal: request.signal,
    timeoutMs: TIMEOUT_MS,
  });
  const message = await stream.result();
  await record(db, request, inUse, estimate, startedAt, message);

  if (message.stopReason === 'error' || message.stopReason === 'aborted') {
    throw new ModelError(message.errorMessage ?? 'The model didn’t answer.');
  }
  return { text: textOf(message), stopReason: message.stopReason };
}
