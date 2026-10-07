import { useCallback, useEffect, useRef, useState } from 'react';
import type { BookSetup } from '@writer/shared/book';
import { everyField, fieldKey, fieldText, filledIn, SUGGEST_AFTER, withFieldText, type BlankSuggestion } from '@writer/shared/suggestions';
import { blanksFor } from '../../data/suggestions';

/*
 * Procreator's suggestions for every blank field on the setup page, all at once (the owner's ask,
 * 2026-10-07). Once the page has a little on it, they're asked for together, so they fit each
 * other, and each shows as faint text in its field (see useGhost). When the owner changes
 * something themselves, they're asked for again, so they go on fitting the page; taking one
 * isn't a change of that kind, since the rest were made to go with it.
 */

/** How long the page is left alone before the blank fields are asked about. */
const ASK_AFTER = 1500;

/** Suggestions, by fieldKey, and the page they were made from. */
interface Made {
  suggestions: Map<string, string>;
  from: BookSetup;
}

export interface Blanks {
  /** The suggestion for each blank field, by fieldKey. */
  blanks: Map<string, string>;
  /** Hides a field's suggestion until the next ones come. */
  dismiss: (key: string) => void;
}

const NONE = new Map<string, string>();

function byKey(fields: BlankSuggestion[]): Map<string, string> {
  const suggestions = new Map<string, string>();
  for (const each of fields) {
    suggestions.set(fieldKey(each.field), each.text);
  }
  return suggestions;
}

/** The page with every suggestion that was taken as it was given put back to blank. */
function withoutTaken(setup: BookSetup, suggestions: Map<string, string>): BookSetup {
  let page = setup;
  for (const field of everyField(setup)) {
    const suggestion = suggestions.get(fieldKey(field));
    if (suggestion === undefined) {
      continue;
    }
    if (fieldText(page, field) !== suggestion) {
      continue;
    }
    const blanked = withFieldText(page, field, '');
    if (blanked) {
      page = blanked;
    }
  }
  return page;
}

/** Whether the owner has changed the page since the suggestions were made, besides taking them. */
function changedSince(setup: BookSetup, made: Made): boolean {
  const page = withoutTaken(setup, made.suggestions);
  return JSON.stringify(page) !== JSON.stringify(made.from);
}

/** The blank fields' suggestions for the setup page as it stands. */
export function useBlanks(setup: BookSetup, bookId: string | null): Blanks {
  const [made, setMade] = useState<Made | null>(null);
  const [asking, setAsking] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  // The call on its way, stopped only when the page goes: a change while it's out asks again
  // once it's back.
  const call = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => call.current?.abort();
  }, []);

  const enough = filledIn(setup) >= SUGGEST_AFTER;

  useEffect(() => {
    if (asking || !enough) {
      return;
    }
    if (made && !changedSince(setup, made)) {
      return;
    }
    const timer = window.setTimeout(() => {
      const ctrl = new AbortController();
      call.current = ctrl;
      setAsking(true);
      const asked = setup;
      blanksFor({ setup: asked, bookId }, ctrl.signal).then(
        (fields) => {
          if (ctrl.signal.aborted) {
            return;
          }
          setMade({ suggestions: byKey(fields), from: asked });
          setDismissed(new Set());
          setAsking(false);
        },
        () => {
          if (ctrl.signal.aborted) {
            return;
          }
          // When Procreator can't help (offline, or no answer), what's shown stays, and it isn't
          // asked again until the owner changes something.
          setMade((before) => {
            let suggestions = NONE;
            if (before) {
              suggestions = before.suggestions;
            }
            return { suggestions, from: withoutTaken(asked, suggestions) };
          });
          setAsking(false);
        },
      );
    }, ASK_AFTER);
    return () => window.clearTimeout(timer);
  }, [setup, bookId, asking, enough, made]);

  const dismiss = useCallback((key: string) => {
    setDismissed((before) => new Set(before).add(key));
  }, []);

  if (!made || !enough) {
    return { blanks: NONE, dismiss };
  }
  if (dismissed.size === 0) {
    return { blanks: made.suggestions, dismiss };
  }
  const blanks = new Map(made.suggestions);
  for (const key of dismissed) {
    blanks.delete(key);
  }
  return { blanks, dismiss };
}
