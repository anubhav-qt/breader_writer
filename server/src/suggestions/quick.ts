import {
  clampThinkingLevel,
  getSupportedThinkingLevels,
  normalizeContext,
  streamSimple,
  usesGoogleThinkingLevel,
  type Api,
  type Model,
  type UserMessage,
} from '@writer/pi-ai';
import type { Catalog } from '../ai/catalog.ts';
import { counted, ModelError, recordCall, textOf, thinkingOf, type CallTag, type Sent } from '../ai/call.ts';
import type { InUse } from '../ai/settings.ts';
import type { Db } from '../db/client.ts';

/*
 * The faint text's call to the model: one ask and its answer, on the account's own model,
 * thinking as little as it can, since the suggestions have to land while the owner is still on
 * the page.
 */

/** What setup help runs on: the database, the model, and the account and book it's for. */
export interface Helper {
  db: Db;
  catalog: Catalog;
  inUse: InUse;
  userId: string;
  /** The book, once it's made and only if it's the account's. */
  bookId: string | null;
  /** Stops the call when nobody is waiting for it any more. */
  signal?: AbortSignal;
}

/**
 * The account's model, thinking as little as it can: the faint text has to land before the owner
 * starts typing (the owner's call, 2026-10-06). Left to itself, Gemini 3.8 Flash thought for 7 to
 * 16 seconds a field. Gemini 3 takes no less than low through the proxy ("minimal" is turned
 * away, and no thinking at all doesn't always hold), and at low it answered in 3 to 5. Any other
 * model thinks at the lowest level the catalog knows it takes.
 */
function quick(inUse: InUse): InUse {
  const model = inUse.model;
  if (usesGoogleThinkingLevel(model)) {
    // Without the proxy's management key the catalog can't tell that the model thinks, and pi
    // would send no level at all.
    const thinks: Model<Api> = { ...model, reasoning: true };
    const level = clampThinkingLevel(thinks, 'low');
    return { model: thinks, choice: { model: inUse.choice.model, thinking: level } };
  }
  const levels = getSupportedThinkingLevels(model);
  return { model, choice: { model: inUse.choice.model, thinking: levels[0] } };
}

/**
 * Asks once, with these instructions, and gives the answer's text, or null when nobody is waiting
 * for it any more. A call that comes back with no answer is a ModelError. Each call is recorded as
 * setup help.
 */
export async function askQuickly(helper: Helper, system: string, ask: string): Promise<string | null> {
  const message: UserMessage = { role: 'user', content: ask, timestamp: Date.now() };
  const context = normalizeContext({ systemPrompt: system, messages: [message] });

  const inUse = quick(helper.inUse);
  const sent: Sent = { startedAt: new Date(), estimate: counted(context.messages) };
  const stream = streamSimple(inUse.model, context, {
    reasoning: thinkingOf(inUse),
    apiKey: helper.catalog.proxy.apiKey,
    signal: helper.signal,
    // The instructions are the same for every call and the page changes only as the owner
    // types, so calls close together share their start. The cache is asked to last as long as
    // the provider keeps one, keyed by the book, or the account while the book isn't made.
    sessionId: helper.bookId ?? helper.userId,
    cacheRetention: 'long',
  });
  const answer = await stream.result();
  const tag: CallTag = { userId: helper.userId, bookId: helper.bookId, sceneId: null, turnId: null, role: 'setup' };
  await recordCall(helper.db, tag, inUse, sent, answer);

  if (answer.stopReason === 'aborted') {
    return null;
  }
  if (answer.stopReason === 'error') {
    throw new ModelError(answer.errorMessage ?? 'The model didn’t answer.');
  }
  return textOf(answer);
}
