import { BookList, type BookCard } from '@writer/shared/protocol';
import { writer } from '../lib/api';

/** A book in the library, as its card shows it. */
export type Book = BookCard;

/** The lengths a book is set up with (see CLAUDE.md), by their word goal. */
const LENGTHS = [
  { words: 8000, name: 'Short story' },
  { words: 30000, name: 'Novella' },
  { words: 50000, name: 'Light novel' },
  { words: 80000, name: 'Novel' },
];

export function lengthName(b: Book): string {
  const length = LENGTHS.find((l) => l.words === b.wordGoal);
  if (length) return length.name;
  return `${b.wordGoal.toLocaleString('en-GB')} words`;
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
