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
import type { DraftSetup, FieldRef } from '@writer/shared/suggestions';
import type { Catalog } from '../ai/catalog.ts';
import { counted, ModelError, recordCall, textOf, thinkingOf, type CallTag, type Sent } from '../ai/call.ts';
import type { InUse } from '../ai/settings.ts';
import type { Db } from '../db/client.ts';
import { render } from '../prompts/render.ts';
import { ghostFrom } from './ghost.ts';
import { fieldView, refsOf, setupView, type FieldView } from './view.ts';

/*
 * Procreator's suggestion for the field the owner clicks into on the setup page: one call, made
 * from the page as it stands, on the account's own model, thinking as little as it can.
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
 * The account's model, thinking as little as it can: the faint text is a few words that have to
 * land before the owner starts typing (the owner's call, 2026-10-06). Left to itself, Gemini 3.8
 * Flash thought for 7 to 16 seconds a field. Gemini 3 takes no less than low through the proxy
 * ("minimal" is turned away, and no thinking at all doesn't always hold), and at low it answered
 * in 3 to 5. Any other model thinks at the lowest level the catalog knows it takes.
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

/** How much to suggest: by the field's size, and whether anything is written in it yet. */
function lengthFor(field: FieldView): string {
  if (field.size === 'line') {
    return 'a few words, on one line';
  }
  if (field.size === 'long' && field.text === '') {
    return 'one to three sentences';
  }
  if (field.size === 'long') {
    return 'a sentence or two, going on from where it stops';
  }
  if (field.text === '') {
    return 'a few short lines';
  }
  return 'a line or two more';
}

/**
 * The faint text for a field: what could come after its text, joined to it (ghostFrom), or empty
 * when Procreator has nothing to add or nobody is waiting any more. Null when the field isn't on
 * the page. A call that comes back with no answer is a ModelError.
 */
export async function suggestField(helper: Helper, setup: DraftSetup, field: FieldRef): Promise<string | null> {
  const refs = refsOf(setup);
  const view = fieldView(setup, field, refs);
  if (!view) {
    return null;
  }
  const system = render('suggestions/field-system.njk', {});
  const ask = render('suggestions/field.njk', { page: setupView(setup, refs), field: view, length: lengthFor(view) });
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
    return '';
  }
  if (answer.stopReason === 'error') {
    throw new ModelError(answer.errorMessage ?? 'The model didn’t answer.');
  }
  return ghostFrom(view.text, textOf(answer), view.size, view.max);
}
