import { z } from 'zod';
import { BookSetup, Character, Darkness, Id, Length, Pov, Relationship, TITLE_LIMIT, World } from './book.ts';

/*
 * The story mid play, as the Story panel shows it and changes it (step 6). The owner can change
 * anything setup can (the owner's picks, 2026-10-11): someone's sheet, someone new, someone
 * leaving, a line, two untied, and the book's own choices and world at the panel's end. Every
 * change but a rename, a title or a length asks how far back it reaches (see CLAUDE.md, "A change
 * can reach back to the start").
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
  /** Whether anything has been played yet: before then, a change has no past to reach back into. */
  played: z.boolean(),
});
export type StoryView = z.infer<typeof StoryView>;
