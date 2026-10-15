import { BookView } from '@writer/shared/reading';
import { writer, writerUrl } from '../lib/api';
import { readLocal, writeLocal } from '../lib/store';

/*
 * The book as it's written (step 7): its chapters for the book view, its download, where the owner
 * is in it, and how many chapters they've seen, for the play's new chapter mark.
 */

/** The book as it's written so far. Asking also has the server write any chapter that's missing. */
export async function fetchBook(bookId: string): Promise<BookView> {
  const data = await writer.get<unknown>(`/v1/books/${bookId}/book`);
  return BookView.parse(data);
}

/** The address of the book as an EPUB file. */
export function epubUrl(bookId: string): string {
  return writerUrl(`/v1/books/${bookId}/epub`);
}

/** Where the owner is in a book: the place, kept in this browser. */
export interface Place {
  pos: { section: number; block: number; offset: number };
  progress: number;
  line: string;
}

const PLACES = 'writer.place.v1';

export function placeIn(bookId: string): Place | null {
  const places = readLocal<Record<string, Place>>(PLACES, {});
  return places[bookId] ?? null;
}

export function keepPlace(bookId: string, place: Place) {
  const places = readLocal<Record<string, Place>>(PLACES, {});
  places[bookId] = place;
  writeLocal(PLACES, places);
}

const SEEN = 'writer.bookSeen.v1';

/** How many chapters of a book the owner has seen in the book view, in this browser. */
export function chaptersSeen(bookId: string): number {
  const seen = readLocal<Record<string, number>>(SEEN, {});
  return seen[bookId] ?? 0;
}

export function seeChapters(bookId: string, count: number) {
  const seen = readLocal<Record<string, number>>(SEEN, {});
  if (seen[bookId] === count) {
    return;
  }
  seen[bookId] = count;
  writeLocal(SEEN, seen);
}
