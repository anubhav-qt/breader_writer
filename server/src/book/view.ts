import { and, asc, eq, ne } from 'drizzle-orm';
import type { BookView } from '@writer/shared/reading';
import type { BookRow } from '../books/setup.ts';
import type { Db } from '../db/client.ts';
import { scenes } from '../db/schema.ts';
import { chaptersOf } from '../story/chapters.ts';
import type { Scribe } from './scribe.ts';

/*
 * The book as the book view shows it and the EPUB holds it (step 7): its chapters in order, and the
 * scenes wrapped up and waiting to be written.
 */

/** The book as it's written so far, by `author`, with whether the scribe is writing in it now. */
export async function bookView(db: Db, book: BookRow, author: string, scribe: Scribe | null): Promise<BookView> {
  const written = await chaptersOf(db, book.id);
  const done = new Set(written.map((chapter) => chapter.number));
  const ended = await db
    .select()
    .from(scenes)
    .where(and(eq(scenes.bookId, book.id), eq(scenes.status, 'ended'), ne(scenes.summary, '')))
    .orderBy(asc(scenes.number));
  const unwritten = ended.filter((scene) => !done.has(scene.number));
  const waiting = unwritten.map((scene) => scene.number);
  const all = await db.select().from(scenes).where(eq(scenes.bookId, book.id)).orderBy(asc(scenes.number));
  const last = all.at(-1);
  // The story ended when nothing is being played or waits after its last scene, and it's wrapped up.
  const open = all.some((scene) => scene.status !== 'ended');
  const finished = last !== undefined && !open && last.summary !== '';
  let writing = false;
  if (scribe) {
    writing = scribe.busy(book.id);
  }
  return {
    bookId: book.id,
    title: book.title,
    author,
    color: book.color,
    chapters: written.map((chapter) => ({ number: chapter.number, title: chapter.title, body: chapter.body, words: chapter.words })),
    waiting,
    writing,
    wordsWritten: book.wordsWritten,
    wordGoal: book.wordGoal,
    finished,
  };
}
