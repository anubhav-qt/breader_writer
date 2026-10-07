import { BlankSuggestions, FieldSuggestion, type BlankSuggestion, type BlanksAsk, type FieldAsk } from '@writer/shared/suggestions';
import { writer } from '../lib/api';

/*
 * Procreator's help with setup (step 5), from the writer's server.
 */

/** How long a field's suggestion may take: the model thinks first, if only a little. */
const SUGGESTION_TIMEOUT = 60_000;

/** How long the blank fields' suggestions may take: on a big cast there are a lot of them. */
const BLANKS_TIMEOUT = 180_000;

/** Procreator's faint text for a field, to show after what's in it, or '' when it has none. */
export async function suggestFor(ask: FieldAsk, signal: AbortSignal): Promise<string> {
  const data = await writer.post<unknown>('/v1/suggestions/field', ask, SUGGESTION_TIMEOUT, signal);
  return FieldSuggestion.parse(data).text;
}

/** Procreator's faint text for every blank field on the page, made together. */
export async function blanksFor(ask: BlanksAsk, signal: AbortSignal): Promise<BlankSuggestion[]> {
  const data = await writer.post<unknown>('/v1/suggestions/blanks', ask, BLANKS_TIMEOUT, signal);
  return BlankSuggestions.parse(data).fields;
}
