import { FieldSuggestion, type FieldAsk } from '@writer/shared/suggestions';
import { writer } from '../lib/api';

/*
 * Procreator's help with setup (step 5), from the writer's server.
 */

/** How long a suggestion may take: the model thinks first, as hard as the account's pick says. */
const SUGGESTION_TIMEOUT = 60_000;

/** Procreator's faint text for a field, to show after what's in it, or '' when it has none. */
export async function suggestFor(ask: FieldAsk, signal: AbortSignal): Promise<string> {
  const data = await writer.post<unknown>('/v1/suggestions/field', ask, SUGGESTION_TIMEOUT, signal);
  return FieldSuggestion.parse(data).text;
}
