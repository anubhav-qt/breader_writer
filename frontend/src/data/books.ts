import type { Length } from '@writer/shared/book';
import { BookList, type BookCard } from '@writer/shared/protocol';
import { writer } from '../lib/api';

/** A book in the library, as its card shows it. */
export type Book = BookCard;

/** The lengths a book is set up with (see CLAUDE.md). */
export const LENGTH_NAMES: Record<Length, string> = {
  short_story: 'Short story',
  novella: 'Novella',
  light_novel: 'Light novel',
  novel: 'Novel',
};

export function lengthName(b: Book): string {
  return LENGTH_NAMES[b.length];
}

/** How much of the book is written, from 0 to 1: words written over the goal. */
export function written(b: Book): number {
  if (b.wordGoal <= 0) return 0;
  const share = b.wordsWritten / b.wordGoal;
  if (share > 1) return 1;
  return share;
}

/** The account's books, most recent first. */
export async function fetchBooks(): Promise<Book[]> {
  const data = await writer.get<unknown>('/v1/books');
  return BookList.parse(data).books;
}
