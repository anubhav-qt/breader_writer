import { z } from 'zod';
import { BookSetup, Character, Darkness, Id, Length, LONG_LIMIT, Pov, Relationship, SHORT_LIMIT, TITLE_LIMIT, World } from './book.ts';

/*
 * The story mid play, as the Story panel shows it and changes it (step 6). The owner can change
 * anything setup can (the owner's picks, 2026-10-11): someone's sheet, someone new, someone
 * leaving, a line, two untied, and the book's own choices and world at the panel's end. Every
 * change but a rename, a title or a length asks how far back it reaches (see CLAUDE.md, "A change
 * can reach back to the start"). One that reaches back is rewritten into what was played at once,
 * and listed after (the owner's pick, 2026-10-11).
 *
 * The Notes panel changes the rest the same way: the reference's pages and Procreator's memory.
 * A page asks how far back it reaches too, unless it says where the story is going (Plan,
 * Threads); memory is Procreator's notes on the work, not the story, so it always saves plainly.
 */

/**
 * How far back a change reaches: from now on (a change in the story at this point, which
 * Procreator plays as something that just happened), or always so (everything played that says
 * otherwise is rewritten to match).
 */
export const Reach = z.enum(['now', 'always']);
export type Reach = z.infer<typeof Reach>;

/** The book's own choices and its world, as the Story panel's end saves them. */
export const BookChoices = z.object({
  title: z.string().trim().min(1, 'The book needs a title.').max(TITLE_LIMIT),
  length: Length,
  pov: Pov,
  darkness: Darkness,
  world: World,
});
export type BookChoices = z.infer<typeof BookChoices>;

/**
 * The kinds of page in the reference. A character's goes by the person it's about; the owner makes
 * and changes any other kind in the Notes panel.
 */
export const PageKind = z.enum(['character', 'place', 'group', 'thing', 'lore', 'story']);
export type PageKind = z.infer<typeof PageKind>;

/** The story's own pages, by title: where it's going, what it set up, and what happened when. */
export const PLAN = 'Plan';
export const THREADS = 'Threads';
export const TIMELINE = 'Timeline';

/**
 * The most characters a page the owner saves holds. Procreator's pages have no limit of their own;
 * this only keeps an edit inside what a request can carry (the server takes 1 MB).
 */
export const PAGE_LIMIT = 200_000;

/** A page of the reference as the owner reads and edits it, people in the cast as links, [[Name]]. */
export const ReferencePage = z.object({
  id: z.uuid(),
  kind: PageKind,
  /** On a character's page, the person it's about. */
  characterId: Id.nullable(),
  /** What it's called: on a character's page, their name. */
  title: z.string(),
  /** One line for the index: what it holds. */
  about: z.string(),
  body: z.string(),
});
export type ReferencePage = z.infer<typeof ReferencePage>;

/** A note in Procreator's memory, as the owner reads and edits it. */
export const MemoryNote = z.object({ id: z.number().int(), text: z.string() });
export type MemoryNote = z.infer<typeof MemoryNote>;

/**
 * A page as the owner saves it: one of the reference changed (its id), or a new one (no id). A
 * character's page goes by the person it's about, and keeps their name as its title.
 */
export const PageDraft = z.object({
  id: z.uuid().nullable(),
  characterId: Id.nullable(),
  kind: PageKind,
  title: z.string().trim().max(TITLE_LIMIT),
  about: z.string().trim().max(SHORT_LIMIT),
  body: z.string().trim().min(1, 'A page needs something on it.').max(PAGE_LIMIT),
});
export type PageDraft = z.infer<typeof PageDraft>;

/** Whether a page says where the story is going (Plan, Threads), which the owner is asked before reading. */
export function isAhead(page: { kind: string; characterId: string | null; title: string }): boolean {
  if (page.kind !== 'story' || page.characterId !== null) {
    return false;
  }
  const title = page.title.trim().toLowerCase();
  return title === PLAN.toLowerCase() || title === THREADS.toLowerCase();
}

/** One change the owner makes mid story. */
export const StoryEdit = z.discriminatedUnion('kind', [
  /** Someone's sheet, as it stands after the change. */
  z.object({ kind: z.literal('sheet'), character: Character }),
  /** Someone new in the cast, with a sheet the owner wrote. */
  z.object({ kind: z.literal('join'), character: Character }),
  /** Someone leaves the cast. */
  z.object({ kind: z.literal('leave'), id: Id }),
  /** A line between two people, tied or changed. */
  z.object({ kind: z.literal('line'), relationship: Relationship }),
  /** Two people untied. */
  z.object({ kind: z.literal('untie'), a: Id, b: Id }),
  /** The book's own choices and its world. */
  z.object({ kind: z.literal('book'), book: BookChoices }),
  /** A page of the reference, made or changed. */
  z.object({ kind: z.literal('page'), page: PageDraft }),
  /** A page taken out of the reference. */
  z.object({ kind: z.literal('unpage'), id: z.uuid() }),
  /** A note in Procreator's memory, new (no id) or changed. */
  z.object({ kind: z.literal('note'), id: z.number().int().nullable(), text: z.string().trim().min(1, 'The note is empty.').max(LONG_LIMIT) }),
  /** A note taken out of Procreator's memory. */
  z.object({ kind: z.literal('forget'), id: z.number().int() }),
]);
export type StoryEdit = z.infer<typeof StoryEdit>;

/** POST /v1/books/:id/story/edits: a change, and how far back it reaches. */
export const EditAsk = z.object({ edit: StoryEdit, reach: Reach });
export type EditAsk = z.infer<typeof EditAsk>;

/** The story as the Story panel shows it. GET /v1/books/:id/story, and what an edit answers. */
export const StoryView = z.object({
  /** The book's choices, its world, and the cast as it stands, with the lines between them. */
  setup: BookSetup,
  /** Procreator's page about each person, by id, as the owner reads it. */
  pages: z.record(z.string(), z.string()),
  /** The reference, every page, characters' included, as the Notes panel reads and edits it. */
  reference: z.array(ReferencePage),
  /** Procreator's memory, oldest first. */
  memory: z.array(MemoryNote),
  /** Whether anything has been played yet: before then, a change has no past to reach back into. */
  played: z.boolean(),
});
export type StoryView = z.infer<typeof StoryView>;

/** What a change that reached back rewrote: the change that keeps the passages (null when none needed it), and how many. */
export const Rewrote = z.object({
  change: z.number().int().nullable(),
  count: z.number().int(),
});
export type Rewrote = z.infer<typeof Rewrote>;

/**
 * What POST /v1/books/:id/story/edits streams: while a change that reaches back is rewritten, how
 * many parts of the story are done; then the story as it stands, with what was rewritten (null
 * for a change that didn't reach back), or why it couldn't be made, with the story as it stands.
 */
export const EditEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('rewriting'), done: z.number().int(), of: z.number().int() }),
  z.object({ type: z.literal('done'), story: StoryView, rewrote: Rewrote.nullable() }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string(), story: StoryView }),
]);
export type EditEvent = z.infer<typeof EditEvent>;

/** A passage a change rewrote: where it is, and what it said before and after. */
export const RewrittenPassage = z.object({
  where: z.string(),
  before: z.string(),
  after: z.string(),
});
export type RewrittenPassage = z.infer<typeof RewrittenPassage>;

/** GET /v1/books/:id/story/rewrites/:change: what a change rewrote, passage by passage. */
export const RewriteView = z.object({
  what: z.string(),
  passages: z.array(RewrittenPassage),
});
export type RewriteView = z.infer<typeof RewriteView>;
