/*
 * The book as the reader reads it: breader's flowing book (breader's books/types.ts), built from
 * the chapters written so far (BookPage.tsx) instead of read from a file.
 */

/** One chapter-sized chunk of the book, as HTML. */
export interface Section {
  title: string;
  html: string;
  words: number;
}

export interface TocItem {
  title: string;
  section: number;
  anchor?: string;
  level: number;
}

export interface FlowBook {
  kind: 'flow';
  title: string;
  author: string;
  sections: Section[];
  toc: TocItem[];
  words: number;
}

/** A place in the book: section, block (paragraph-level element) and character offset in that block. */
export interface Position {
  section: number;
  block: number;
  offset: number;
}
