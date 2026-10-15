import type { FlowBook } from './types';
import type { Loc } from './FlowView';

/*
 * The book's chapters as stretches of it, for the contents and the progress dots: breader's
 * (features/reader/chapters.ts), for a book of text.
 */

/** A top-level chapter as a stretch of the whole book, for progress tracks and scrubbers. */
export interface Chapter {
  title: string;
  section: number;
  anchor?: string;
  /** Where it starts and ends, as fractions of the book’s words. */
  start: number;
  end: number;
  words: number;
}

export function chaptersOf(book: FlowBook): Chapter[] {
  const starts: number[] = [];
  let acc = 0;
  for (const s of book.sections) { starts.push(acc); acc += s.words; }
  const total = acc || 1;
  const tops = book.toc.filter((t) => t.level === 0);
  const raw = tops.length ? tops : book.sections.map((s, i) => ({ title: s.title, section: i, anchor: undefined }));
  // One chapter per section, in reading order.
  const seen = new Set<number>();
  const items = raw
    .filter((t) => t.section < book.sections.length && !seen.has(t.section) && seen.add(t.section))
    .sort((a, b) => a.section - b.section);
  if (!items.length) return [{ title: book.title, section: 0, start: 0, end: 1, words: acc }];
  return items.map((t, i) => {
    // The first chapter also covers any front matter before it.
    const from = i === 0 ? 0 : t.section;
    const to = items[i + 1]?.section ?? book.sections.length;
    let words = 0;
    for (let s = from; s < to; s++) words += book.sections[s].words;
    return {
      title: t.title || `Chapter ${i + 1}`,
      section: t.section,
      anchor: t.anchor,
      start: starts[from] / total,
      end: to < starts.length ? starts[to] / total : 1,
      words,
    };
  });
}

/** The chapter holding the reader's place. */
export function chapterAt(chapters: Chapter[], loc: Pick<Loc, 'section'> | null): number {
  if (!loc) return 0;
  let at = 0;
  chapters.forEach((c, i) => { if (c.section <= loc.section) at = i; });
  return at;
}

/** The chapter at a fraction of the book. */
export function chapterAtFraction(chapters: Chapter[], f: number): number {
  let at = 0;
  chapters.forEach((c, i) => { if (c.start <= f) at = i; });
  return at;
}

/** How far through a chapter the reader is, 0 to 1. */
export const within = (c: Chapter, progress: number) =>
  c.end > c.start ? Math.max(0, Math.min(1, (progress - c.start) / (c.end - c.start))) : progress >= c.end ? 1 : 0;

export const pad2 = (n: number) => String(n).padStart(2, '0');

/** Titles that carry their own number ("Chapter IV", "Part 2", "XII. The Trial") don't get ours. */
export const numbered = (title: string) =>
  /^\s*(chapter|ch\.|part|book|section|letter|canto|act|stave)(\b|\s)/i.test(title) || /^\s*([IVXLCDM]+|\d+)[.:)]/.test(title);

/** "07 · The Pool of Tears", or just the title when it's already numbered. */
export const chapterName = (chapters: Chapter[], i: number) => {
  const c = chapters[i];
  if (!c) return '';
  return numbered(c.title) ? c.title : `${pad2(i + 1)} · ${c.title}`;
};
