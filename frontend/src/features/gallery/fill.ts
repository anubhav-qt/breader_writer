import { genreIds, joinGenres, type GenreId } from '@breader/shared/genres';
import type { ShelfItem } from '../../data/useLibrary';
import { cardAuthors, cardTitle } from './names';
import { detectSeries, plain, seriesKey, seriesNames, tidySeries } from './series';

/*
 * What a book's card leaves blank, filled in from its title and the books like it: a series and its
 * number from the title, and genres from the rest of its series or its author's other books. It's
 * worked out as the library is shown and never saved, so the reader's own picks always win and the
 * guesses get better as the library grows. And a series goes by one name, however its books spell
 * it, set by hand or not.
 */

const words = (s: string) => plain(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** A person however a file names them: "Satou Tsutomu" is "Tsutomu Sato". */
const person = (name: string) => words(name.replace(/ou|oo/gi, 'o').replace(/uu/gi, 'u')).sort().join(' ');

const peopleOf = (b: ShelfItem) => cardAuthors(b.author).map(person).filter(Boolean);

/** Words in a title that say which story it is, besides its series' name and its number. */
const COMMON = new Set(['the', 'and', 'with', 'from', 'into', 'that', 'this', 'vol', 'volume', 'book', 'part', 'chapter', 'arc', 'novel', 'light', 'edition', 'series', 'story', 'stories', 'tale', 'tales', 'collection', 'complete', 'omnibus', 'special', 'side', 'short']);
function storyWords(title: string, series: string) {
  const own = new Set(words(series));
  return words(title).filter((w) => w.length >= 4 && !/^\d+$|^[ivxlc]+$/.test(w) && !COMMON.has(w) && !own.has(w));
}

/** The genres at least half of `lists` have, or else the one most of them have. */
function shared(lists: GenreId[][]): GenreId[] {
  const counts = new Map<GenreId, number>();
  for (const l of lists) for (const g of l) counts.set(g, (counts.get(g) ?? 0) + 1);
  const half = [...counts].filter(([, n]) => n * 2 >= lists.length).map(([g]) => g);
  if (half.length) return half;
  const top = [...counts].sort((a, b) => b[1] - a[1])[0];
  return top ? [top[0]] : [];
}

/** One book once: a copy of a shared book and the book it came from count as one. */
const same = (b: ShelfItem) => b.origin ?? b.id;

/**
 * The genres books like this one are filed under: the rest of its series, or else its first
 * author's other books, wherever else they're credited. Only genres someone picked count.
 */
function genresLike(pool: Array<[ShelfItem, string | undefined]>, series: string | undefined, people: string[]): GenreId[] {
  const lists = (pick: (b: ShelfItem, series?: string) => boolean) => {
    const seen = new Set<string>();
    return pool.flatMap(([b, s]) => {
      const ids = b.guessed?.genre ? [] : genreIds(b.genre);
      if (!ids.length || seen.has(same(b)) || !pick(b, s)) return [];
      seen.add(same(b));
      return [ids];
    });
  };
  const key = series && seriesKey(series);
  const inSeries = key ? lists((_, s) => !!s && seriesKey(s) === key) : [];
  if (inSeries.length) return shared(inSeries);
  return people[0] ? shared(lists((b) => peopleOf(b).includes(people[0]))) : [];
}

/** What a file's subjects say about its genres: "Fiction / Fantasy / Epic" is Fantasy. */
const SUBJECTS: Array<[RegExp, GenreId]> = [
  [/fantasy/i, 'fantasy'],
  [/science[ -]?fiction|\bsci-?fi\b/i, 'scifi'],
  [/myster|detective/i, 'mystery'],
  [/\bcrime\b/i, 'crime'],
  [/thriller|suspense/i, 'thriller'],
  [/horror/i, 'horror'],
  [/romance/i, 'romance'],
  [/historical/i, 'historical'],
  [/literary/i, 'literary'],
  [/adventure/i, 'adventure'],
  [/humou?r/i, 'humour'],
  [/classic/i, 'classics'],
  [/young adult|\bteen/i, 'young'],
  [/juvenile|children/i, 'children'],
  [/light novel/i, 'lightnovel'],
  [/poetry/i, 'poetry'],
  [/biography|memoir/i, 'biography'],
  [/^history\b|\/\s*history\b/i, 'history'],
  [/^science\b(?! ?fiction)|\/\s*science\b(?! ?fiction)/i, 'science'],
  [/philosoph/i, 'philosophy'],
];

/** The genres for a book being added: its series', its author's, or else what its file says. */
export function genreFor(books: ShelfItem[], book: { author: string; series?: string; subjects?: string[] }): string {
  const like = genresLike(books.map((b) => [b, b.series]), book.series, cardAuthors(book.author).map(person));
  if (like.length) return joinGenres(like);
  const found = new Set<GenreId>();
  for (const s of book.subjects ?? []) for (const [re, g] of SUBJECTS) if (re.test(s)) found.add(g);
  // A long list of subjects is a shop's shelving; the first few say the most.
  return joinGenres([...found].slice(0, 3));
}

interface Draft {
  b: ShelfItem;
  name?: string;
  index?: number;
  guessed: NonNullable<ShelfItem['guessed']>;
}

/** Every book with its blanks filled in, in the same order. */
export function fillGaps(books: ShelfItem[]): ShelfItem[] {
  const known = seriesNames(books);
  const drafts = new Map<string, Draft>();
  for (const b of books) {
    if (drafts.has(b.id)) continue;
    const d: Draft = { b, name: b.series?.trim() ? tidySeries(b.series) : undefined, index: b.seriesIndex, guessed: {} };
    if (!d.name && !b.own?.series) {
      const found = detectSeries(b.title, undefined, undefined, known);
      if (found) {
        d.name = found.name;
        d.index = found.index;
        d.guessed = { series: true, ...(found.index !== undefined ? { index: true } : {}) };
      }
    } else if (d.name && d.index === undefined) {
      const found = detectSeries(b.title, undefined, undefined, [{ name: d.name, count: 1 }]);
      const n = found && seriesKey(found.name) === seriesKey(d.name) ? found.index : cardTitle(b.title).vol;
      if (n !== undefined) { d.index = n; d.guessed.index = true; }
    }
    drafts.set(b.id, d);
  }

  // Series that go by different names but are one: "Mahouka Koukou no Rettousei" and "The Irregular
  // at Magic High School". Their books share an author and a story ("Enrollment"), and never a number.
  interface Group { keys: Set<string>; people: Set<string>; firsts: Set<string>; numbers: Set<number>; words: Set<string> }
  const groups = new Map<string, Group>();
  for (const d of drafts.values()) {
    if (!d.name) continue;
    const key = seriesKey(d.name);
    const g = groups.get(key) ?? { keys: new Set([key]), people: new Set(), firsts: new Set(), numbers: new Set(), words: new Set() };
    const people = peopleOf(d.b);
    people.forEach((p) => g.people.add(p));
    if (people[0]) g.firsts.add(people[0]);
    if (d.index !== undefined) g.numbers.add(d.index);
    storyWords(d.b.title, d.name).forEach((w) => g.words.add(w));
    groups.set(key, g);
  }
  const meets = (a: Group, b: Group, of: (g: Group) => Set<unknown>, by: (g: Group) => Set<unknown>) => [...of(a)].some((x) => by(b).has(x));
  const one = [...new Set(groups.values())];
  for (let i = 0; i < one.length; i++) {
    for (let j = i + 1; j < one.length; j++) {
      const [a, b] = [one[i], one[j]];
      if (a === b) continue;
      const author = meets(a, b, (g) => g.firsts, (g) => g.people) || meets(b, a, (g) => g.firsts, (g) => g.people);
      if (!author || meets(a, b, (g) => g.numbers, (g) => g.numbers) || !meets(a, b, (g) => g.words, (g) => g.words)) continue;
      for (const k of b.keys) a.keys.add(k);
      b.people.forEach((p) => a.people.add(p));
      b.firsts.forEach((p) => a.firsts.add(p));
      b.numbers.forEach((n) => a.numbers.add(n));
      b.words.forEach((w) => a.words.add(w));
      for (const k of b.keys) groups.set(k, a);
      one[j] = a;
    }
  }

  // Each goes by the name the reader gave it, or else the one most of its books give, or else its
  // first book's; a name typed all in lower case gives way to one with capitals.
  const names = new Map<Group, string>();
  for (const g of new Set(groups.values())) {
    const votes = new Map<string, { hand: number; count: number; first: number }>();
    const seen = new Set<string>();
    for (const d of drafts.values()) {
      if (!d.name || groups.get(seriesKey(d.name)) !== g || seen.has(same(d.b))) continue;
      seen.add(same(d.b));
      const v = votes.get(d.name) ?? { hand: 0, count: 0, first: Infinity };
      if (d.b.own?.series) v.hand++;
      v.count++;
      v.first = Math.min(v.first, d.index ?? Infinity);
      votes.set(d.name, v);
    }
    const capped = (name: string) => Number(name !== name.toLowerCase());
    const [best] = [...votes].sort(([x, a], [y, b]) => capped(y) - capped(x) || b.hand - a.hand || b.count - a.count || a.first - b.first)[0];
    names.set(g, best);
  }

  const final = [...drafts.values()].map((d): [ShelfItem, string | undefined] => [d.b, d.name && names.get(groups.get(seriesKey(d.name))!)]);
  const patches = new Map<string, Partial<ShelfItem>>();
  for (const [b, series] of final) {
    const d = drafts.get(b.id)!;
    let { guessed } = d;
    let genre = b.genre;
    if (!genreIds(b.genre).length && !b.own?.genre) {
      const like = genresLike(final, series, peopleOf(b));
      if (like.length) { genre = joinGenres(like); guessed = { ...guessed, genre: true }; }
    }
    if (series !== b.series || d.index !== b.seriesIndex || genre !== b.genre) {
      patches.set(b.id, { series, seriesIndex: series ? d.index : undefined, genre, guessed });
    }
  }
  return books.map((b) => { const p = patches.get(b.id); return p ? { ...b, ...p } : b; });
}
