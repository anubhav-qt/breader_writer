import { UNSET_GENRE, genreIds, genreName } from '@breader/shared/genres';
import type { ShelfItem } from '../../data/useLibrary';
import { finishedIn, nextIn, numberOf, seriesGenres, shelfName, type Series } from './series';

/*
 * Below Recent, the whole library again, shelved one of three ways: by genre, by series or by
 * date. Each shelf is a row of cards.
 */

export type View = 'genre' | 'series' | 'date';

export const VIEWS: Array<{ id: View; label: string; title: string }> = [
  { id: 'genre', label: 'Genre', title: 'Genres' },
  { id: 'series', label: 'Series', title: 'Series' },
  { id: 'date', label: 'Date', title: 'Date' },
];

export const isView = (v: unknown): v is View => VIEWS.some((x) => x.id === v);

export interface Entry {
  key: string;
  book: ShelfItem;
  /** Its number in the series whose shelf it's on. */
  number?: number;
  /** A whole series as one card, standing on its next book. */
  stack?: Series;
}

export interface Shelf {
  key: string;
  name: string;
  meta: string;
  entries: Entry[];
  /** The series this shelf is, which its name opens. */
  series?: Series;
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const bookEntry = (b: ShelfItem): Entry => ({ key: b.key ?? b.id, book: b });

/** The shelves a book with these genres stands on: one for each, or unset's ('') for none. */
const shelvesOf = (ids: string[]) => (ids.length ? ids : ['']);

/**
 * Every genre with a book in it, by name, unset last. A book stands on each of its genres' shelves;
 * a series is one card, on each genre at least half its books have. Books keep the order they came
 * in (most recent first).
 */
export function byGenre(books: ShelfItem[], series: Map<string, Series>): Shelf[] {
  const shelves = new Map<string, { entries: Entry[]; series: number; books: number }>();
  const put = (genres: string[], e: Entry, books: number) => {
    for (const genre of shelvesOf(genres)) {
      const s = shelves.get(genre) ?? { entries: [], series: 0, books: 0 };
      s.entries.push(e);
      s.books += books;
      if (e.stack) s.series++;
      shelves.set(genre, s);
    }
  };
  const placed = new Set<Series>();
  for (const b of books) {
    const s = series.get(b.id);
    if (!s) {
      put(genreIds(b.genre), bookEntry(b), 1);
      continue;
    }
    if (placed.has(s)) continue;
    placed.add(s);
    const next = nextIn(s);
    put(seriesGenres(s), { key: s.key, book: next, number: numberOf(s, next), stack: s }, s.books.length);
  }
  return [...shelves]
    .map(([id, s]) => ({
      key: `genre:${id}`,
      name: genreName(id) ?? UNSET_GENRE,
      meta: [s.series && count(s.series, 'series', 'series'), count(s.books, 'book')].filter(Boolean).join(' · '),
      entries: s.entries,
    }))
    .sort((a, b) => Number(a.key === 'genre:') - Number(b.key === 'genre:') || a.name.localeCompare(b.name));
}

/** Every series, by name ("The" and "A" set aside), its books in order. */
export function bySeries(all: Iterable<Series>): Shelf[] {
  return [...new Set(all)]
    .sort((a, b) => shelfName(a.name).localeCompare(shelfName(b.name), undefined, { sensitivity: 'base', numeric: true }))
    .map((s) => ({
      key: s.key,
      name: s.name,
      meta: `${finishedIn(s)} of ${s.books.length} finished`,
      entries: s.books.map((b) => ({ ...bookEntry(b), number: numberOf(s, b) })),
      series: s,
    }));
}

const DAY = 86_400_000;

/** When a book was last opened, as a shelf: this week, last week, a month of the last year, then a year. */
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

/** Every book by when it was last opened, most recent first. */
export function byDate(books: ShelfItem[], now: number): Shelf[] {
  const shelves = new Map<string, Entry[]>();
  for (const b of books) {
    const name = dateShelf(b.lastOpened, now);
    const list = shelves.get(name) ?? [];
    list.push(bookEntry(b));
    shelves.set(name, list);
  }
  return [...shelves].map(([name, entries]) => ({ key: `date:${name}`, name, meta: count(entries.length, 'book'), entries }));
}
