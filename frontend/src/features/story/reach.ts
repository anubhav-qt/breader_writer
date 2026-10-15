import { isAhead, type BookChoices, type PageDraft, type ReferencePage, type StoryView } from '@writer/shared/story';
import type { Character, Relationship, Side, World } from '@writer/shared/book';

/*
 * How a change mid story is saved (see "A change can reach back to the start" in CLAUDE.md): a
 * plain Save, or the owner's pick of "From now on" or "Always so". Before anything is played there's
 * no past to reach back into, so everything saves plainly. A rename always reaches back, so a sheet
 * whose name alone changed saves plainly too, and so do the book's title and length (the pacing
 * follows a length from now on). A page of the reference asks too, unless it says where the story is
 * going (Plan, Threads), which holds from now on; Procreator's memory always saves plainly.
 */

export type SaveKind = 'unchanged' | 'plain' | 'asks';

/** Text as the story keeps it: no space at the ends, and one between words for a name. */
function spaced(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function differs(was: string, now: string): boolean {
  return was.trim() !== now.trim();
}

const SHEET_FIELDS = ['who', 'personality', 'past', 'notes'] as const;

export function sheetSaving(played: boolean, was: Character, now: Character): SaveKind {
  const renamed = spaced(was.name) !== spaced(now.name);
  const rest = SHEET_FIELDS.some((field) => differs(was[field], now[field]));
  if (!renamed && !rest) {
    return 'unchanged';
  }
  if (!played || !rest) {
    return 'plain';
  }
  return 'asks';
}

function sideDiffers(was: Side, now: Side): boolean {
  return differs(was.sees, now.sees) || differs(was.hides, now.hides);
}

/** A line tied for the first time (was is undefined) is a change too: the two are tied. */
export function lineSaving(played: boolean, was: Relationship | undefined, now: Relationship): SaveKind {
  let changed = true;
  if (was) {
    changed = differs(was.bond, now.bond) || sideDiffers(was.a, now.a) || sideDiffers(was.b, now.b);
  }
  if (!changed) {
    return 'unchanged';
  }
  if (!played) {
    return 'plain';
  }
  return 'asks';
}

const WORLD_FIELDS: (keyof World)[] = ['genre', 'tone', 'setting', 'rules', 'notes'];

export function bookSaving(played: boolean, was: BookChoices, now: BookChoices): SaveKind {
  const plainly = spaced(was.title) !== spaced(now.title) || was.length !== now.length;
  const world = WORLD_FIELDS.some((field) => differs(was.world[field], now.world[field]));
  const asking = was.pov !== now.pov || was.darkness !== now.darkness || world;
  if (!plainly && !asking) {
    return 'unchanged';
  }
  if (!played || !asking) {
    return 'plain';
  }
  return 'asks';
}

/** The book's choices and world as the story holds them, as the panel's end saves them. */
export function choicesOf(story: StoryView): BookChoices {
  const setup = story.setup;
  return { title: setup.title, length: setup.length, pov: setup.pov, darkness: setup.darkness, world: setup.world };
}

/** A page made or changed: a new one (was is null), or one of the reference. */
export function pageSaving(played: boolean, was: ReferencePage | null, now: PageDraft): SaveKind {
  let changed = true;
  if (was) {
    const fields = differs(was.title, now.title) || differs(was.about, now.about) || differs(was.body, now.body);
    changed = fields || was.kind !== now.kind;
  }
  if (!changed) {
    return 'unchanged';
  }
  if (!played || isAhead(now)) {
    return 'plain';
  }
  if (was && isAhead(was)) {
    return 'plain';
  }
  return 'asks';
}

/** Whether taking a page out asks how far back it reaches. */
export function unpageAsks(played: boolean, page: ReferencePage): boolean {
  return played && !isAhead(page);
}
