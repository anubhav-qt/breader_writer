import { z } from 'zod';
import { Id } from './book.ts';

/*
 * The book as it's written (step 7): each scene played becomes a chapter of finished prose once
 * it's wrapped up, and the book view reads them like breader's reader reads a book. What it shows,
 * and what the EPUB download holds.
 */

/** A chapter of the book: its scene's number, its title, and its prose, paragraphs a blank line apart. */
export const ChapterView = z.object({
  number: z.number().int(),
  title: z.string(),
  body: z.string(),
  words: z.number().int(),
});
export type ChapterView = z.infer<typeof ChapterView>;

/** GET /v1/books/:id/book: the book as it's written so far. */
export const BookView = z.object({
  bookId: Id,
  title: z.string(),
  /** Who wrote it: the owner's name on breader. */
  author: z.string(),
  /** A palette key from the app's book colours, as the card's. */
  color: z.string(),
  chapters: z.array(ChapterView),
  /** Scenes played and wrapped up that aren't in the book yet, by number: being written, or waiting their turn. */
  waiting: z.array(z.number().int()),
  /** Whether Procreator is writing in the book now. */
  writing: z.boolean(),
  wordsWritten: z.number().int(),
  wordGoal: z.number().int(),
  /** The story has ended and its last scene is wrapped up: once nothing waits, the book is done. */
  finished: z.boolean(),
});
export type BookView = z.infer<typeof BookView>;
