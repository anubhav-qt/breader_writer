import { genreIds } from '@breader/shared/genres';
import type { ShelfItem } from '../../data/useLibrary';

/*
 * Series in the library. Books keep their own cards in Recent; below it, a series is one card among
 * each of its genres' books, and a row of its books in order among the series.
 */
export interface Series {
  key: string;
  name: string;
  /** In reading order. */
  books: ShelfItem[];
}

const inOrder = (a: ShelfItem, b: ShelfItem) =>
  (a.seriesIndex ?? Infinity) - (b.seriesIndex ?? Infinity) || a.addedAt - b.addedAt || a.title.localeCompare(b.title);

/** The series with at least `min` books in `books` (newest first), by book id. */
export function findSeries(books: ShelfItem[], min = 2): Map<string, Series> {
  const groups = new Map<string, ShelfItem[]>();
  for (const b of books) {
    const name = b.series?.trim() && seriesKey(b.series);
    if (name) groups.set(name, [...(groups.get(name) ?? []), b]);
  }
  const out = new Map<string, Series>();
  for (const [name, newest] of groups) {
    if (newest.length < min) continue;
    const ordered = [...newest].sort(inOrder);
    const s: Series = { key: `series:${name}`, name: ordered[0].series!.trim(), books: ordered };
    for (const b of newest) out.set(b.id, s);
  }
  return out;
}

/** A series' name as it's shelved: "The Wheel of Time" goes under W. */
export const shelfName = (name: string) => name.replace(/^(the|a|an)\s+/i, '');

/** "Book 2", or the book's place in the list when it has no number. */
export const numberOf = (s: Series, b: ShelfItem) => b.seriesIndex ?? s.books.indexOf(b) + 1;

export const finishedIn = (s: Series) => s.books.filter((b) => b.progress >= 1).length;

/** The book a series stands for as one card: the first one not finished, or the last once all are. */
export const nextIn = (s: Series) => s.books.find((b) => b.progress < 1) ?? s.books[s.books.length - 1];

/** What most of its books have, or undefined when none does; the next book's breaks a tie. */
function most(values: Array<string | undefined>, tie?: string): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | undefined;
  let n = 0;
  for (const [v, c] of counts) if (c > n || (c === n && v === tie)) { best = v; n = c; }
  return best;
}

/**
 * The genres a series is filed under: every one at least half its books have, or else the one most
 * of them have.
 */
export function seriesGenres(s: Series): string[] {
  const lists = s.books.map((b) => genreIds(b.genre));
  const counts = new Map<string, number>();
  for (const l of lists) for (const g of l) counts.set(g, (counts.get(g) ?? 0) + 1);
  const half = [...counts].filter(([, n]) => n * 2 >= s.books.length).map(([g]) => g);
  if (half.length) return half;
  const top = most(lists.flat(), genreIds(nextIn(s).genre)[0]);
  return top ? [top] : [];
}

/**
 * The name a series' cards go by, when files credit different people first ("Tetsuo 415, Eiji
 * Mikage"): the one most of its books name first. Keyed by book id, for books whose file names it.
 */
export function seriesAuthors(series: Map<string, Series>, first: (raw: string) => string, all: (raw: string) => string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of new Set(series.values())) {
    const name = most(s.books.map((b) => first(b.author)));
    if (!name) continue;
    for (const b of s.books) if (all(b.author).includes(name)) out.set(b.id, name);
  }
  return out;
}

/* Suggestions for the series field in the edit popover. */

export interface SeriesName {
  name: string;
  /** Books in it, across the library and the Shared Library. */
  count: number;
}

/**
 * Every series any book is in, however few books: the reader's, the Shared Library's, and those an
 * EPUB named itself. Spelled as most of its books spell it.
 */
export function seriesNames(books: ShelfItem[]): SeriesName[] {
  const seen = new Set<string>();
  const spellings = new Map<string, Map<string, number>>();
  for (const b of books) {
    const name = b.series?.trim();
    const id = b.origin ?? b.id;
    if (!name || seen.has(id)) continue;
    seen.add(id);
    const key = seriesKey(name);
    const s = spellings.get(key) ?? new Map<string, number>();
    s.set(name, (s.get(name) ?? 0) + 1);
    spellings.set(key, s);
  }
  return [...spellings.values()].map((s) => {
    const [name] = [...s].sort((a, b) => b[1] - a[1])[0];
    return { name, count: [...s.values()].reduce((a, b) => a + b, 0) };
  });
}

/** Lowercase, with accents set aside, so "Emile" finds "Émile". */
export const plain = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** What a file adds after a series' name about its format: "(Light Novel)", "[Manga]". */
const FORMAT = /\s*[([](?:light novels?|ln|novels?|manga|web novel|series)[)\]]\s*$/i;

/** A series' name without the file's note on its format. */
export const tidySeries = (name: string) => name.replace(FORMAT, '').trim() || name.trim();

/**
 * What tells one series from another, whoever spelled it: "The Wheel of Time", "Wheel of Time
 * Series" and "wheel-of-time" are one.
 */
export function seriesKey(name: string) {
  const key = plain(tidySeries(name))
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^(?:the|a|an) /, '')
    .replace(/ (?:series|saga|trilogy|light novels?|novels?)$/, '');
  return key || plain(name.trim());
}

/** A series' name as the library already spells it, for a book joining it. */
export const spellSeries = (name: string, known: SeriesName[]) => known.find((s) => seriesKey(s.name) === seriesKey(name))?.name ?? name;

/**
 * The series that match what's typed: names that start with it first, then those with a word that
 * does, then any that hold it; bigger series first within each.
 */
export function matchSeries(all: SeriesName[], typed: string, limit = 6): SeriesName[] {
  const q = plain(typed.trim());
  if (!q) return [];
  const rank = (n: string) => {
    const p = plain(n);
    // Already typed as it is: only worth offering when it's spelled differently.
    if (p === q) return n === typed.trim() ? -1 : 0;
    if (p.startsWith(q)) return 0;
    if (p.split(/[\s\-\u2013:,.'\u2019()]+/).some((w) => w.startsWith(q))) return 1;
    return p.includes(q) ? 2 : -1;
  };
  return all
    .map((s) => ({ s, r: rank(s.name) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || b.s.count - a.s.count || a.s.name.localeCompare(b.s.name))
    .slice(0, limit)
    .map((x) => x.s);
}

/* Finding a new book's series */

export interface FoundSeries {
  name: string;
  index?: number;
  /** Where it came from: the file's own details, or its title or file name. */
  from: 'file' | 'title';
}

const NUM = String.raw`(\d{1,4}(?:\.\d+)?)`;
const MARK = String.raw`(?:#|book|bk\.?|vol\.?|volume|part|no\.?|n\u00ba)`;
/** Hyphen, en dash or em dash. */
const DASH = String.raw`\-\u2013\u2014`;
/** "(Mistborn #1)", "[Discworld, Book 5]", at the end of a title. */
const TRAILING = new RegExp(String.raw`[(\[]\s*([^()\[\]]+?)\s*,?\s*${MARK}\s*${NUM}\s*[)\]]\s*$`, 'i');
/** "Discworld Book 5: Sourcery", "Wheel of Time #3 - The Dragon Reborn". */
const LEADING = new RegExp(String.raw`^\s*(.+?)\s*,?\s+${MARK}\s*${NUM}\s*[:.${DASH}]\s+\S`, 'i');
/** "Discworld 05 - Sourcery": only trusted for a series the library already has. */
const BARE = new RegExp(String.raw`^\s*(.+?)\s+${NUM}\s+[${DASH}]\s+\S`, 'i');
/**
 * "The Empty Box and Zeroth Maria, Vol. 5 (light novel)", "Mistborn #2", "Name, Book 3: Sub". A bare
 * "Book 2" needs the comma, or "The Jungle Book 2" would be a series.
 */
const ENDING = new RegExp(String.raw`^\s*(.+?)(?:\s*,\s*${MARK}|\s+(?:#|vol\.?|volume))\s*${NUM}(?:\s*[(\[][^()\[\]]*[)\]])*\s*(?:[:.${DASH}]\s*\S.*)?$`, 'i');

/**
 * The series a new book is in: what its file says, or failing that what its title or file name
 * say, spelled the way the library already spells it.
 */
export function detectSeries(title: string, fileName: string | undefined, fromFile: { name: string; index?: number } | undefined, known: SeriesName[]): FoundSeries | null {
  const spelled = (name: string) => known.find((s) => seriesKey(s.name) === seriesKey(name))?.name;
  if (fromFile?.name.trim()) {
    const name = tidySeries(fromFile.name);
    return { name: spelled(name) ?? name, index: fromFile.index, from: 'file' };
  }
  const stem = fileName?.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_]+/g, ' ');
  for (const text of [title, stem]) {
    if (!text) continue;
    for (const re of [TRAILING, ENDING, LEADING, BARE]) {
      const m = re.exec(text);
      if (!m) continue;
      const name = tidySeries(m[1]);
      const known = spelled(name);
      if (re === BARE && !known) continue;
      if (name.length < 2 || /^\d+$/.test(name)) continue;
      return { name: known ?? name, index: Number(m[2]), from: 'title' };
    }
  }
  return null;
}
