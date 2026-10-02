import type { Book } from '../../data/books';

/*
 * Below Recent, the whole library again, shelved by when each book was last played. Each shelf
 * is a row of cards.
 */

export interface Shelf {
  key: string;
  name: string;
  meta: string;
  books: Book[];
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const DAY = 86_400_000;

/** When a book was last played, as a shelf: this week, last week, a month of the last year, then a year. */
export function dateShelf(t: number, now: number): string {
  const d = new Date(t);
  const n = new Date(now);
  const days = (now - t) / DAY;
  if (days < 7) return 'This week';
  if (days < 14) return 'Last week';
  const months = (n.getFullYear() - d.getFullYear()) * 12 + n.getMonth() - d.getMonth();
  if (months <= 0) return 'Earlier this month';
  if (months < 12) {
    const month = d.toLocaleDateString('en-GB', { month: 'long' });
    return d.getFullYear() === n.getFullYear() ? month : `${month} ${d.getFullYear()}`;
  }
  // Last year's later months have their own shelves (until December, when this year's fill them).
  const y = d.getFullYear();
  return y === n.getFullYear() - 1 && n.getMonth() < 11 ? `Earlier in ${y}` : String(y);
}

/** Every book by when it was last played, most recent first. */
export function byDate(books: Book[], now: number): Shelf[] {
  const shelves = new Map<string, Book[]>();
  for (const b of books) {
    const name = dateShelf(b.updatedAt, now);
    const list = shelves.get(name) ?? [];
    list.push(b);
    shelves.set(name, list);
  }
  return [...shelves].map(([name, list]) => ({ key: `date:${name}`, name, meta: count(list.length, 'book'), books: list }));
}
