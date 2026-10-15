import { and, asc, eq, sum } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.ts';
import { books, chapters } from '../db/schema.ts';
import { edit, make, type Change } from './changes.ts';
import type { Scene } from './scenes.ts';

/*
 * The book: each scene played, once it's wrapped up, written up as a chapter of finished prose
 * (procreator/author.ts). One scene is one chapter, numbered as its scene is. A chapter is part of
 * the story, kept through the change log, so a change that reaches back rewrites it with the turns
 * and keeps what it said. The book's words written are the chapters' words, and a full bar is a
 * finished book. Only breading_ground calls the writes here.
 */

export type Chapter = typeof chapters.$inferSelect;

/** A chapter as Procreator wrote it: its title and its prose. */
export interface Written {
  title: string;
  body: string;
}

/** The words in a text, as a reader counts them. */
export function countWords(text: string): number {
  const words = text.trim().split(/\s+/);
  return words.filter((word) => word !== '').length;
}

/** A book's chapters, in order. */
export async function chaptersOf(db: Db | Tx, bookId: string): Promise<Chapter[]> {
  return db.select().from(chapters).where(eq(chapters.bookId, bookId)).orderBy(asc(chapters.number));
}

/** A scene's chapter, or null while it isn't written. */
export async function chapterOf(db: Db | Tx, sceneId: string): Promise<Chapter | null> {
  const [chapter] = await db.select().from(chapters).where(eq(chapters.sceneId, sceneId));
  return chapter ?? null;
}

/** The book's words written, counted again from its chapters, kept on the book as part of the change. */
export async function recountBook(tx: Tx, change: Change, bookId: string) {
  const [row] = await tx
    .select({ words: sum(chapters.words) })
    .from(chapters)
    .where(eq(chapters.bookId, bookId));
  const words = Number(row?.words ?? 0);
  const [book] = await tx.select().from(books).where(eq(books.id, bookId));
  if (!book || book.wordsWritten === words) {
    return;
  }
  await edit(tx, change, books, { id: bookId }, { wordsWritten: words });
}

/** A chapter's word count, kept up with its text after a rewrite. */
async function recountChapter(tx: Tx, change: Change, id: string) {
  const [chapter] = await tx.select().from(chapters).where(eq(chapters.id, id));
  if (!chapter) {
    return;
  }
  const words = countWords(chapter.body);
  if (words !== chapter.words) {
    await edit(tx, change, chapters, { id }, { words });
  }
}

/** A scene written into the book, or written again, and the book's words counted again. */
export async function keepChapter(tx: Tx, change: Change, scene: Scene, written: Written): Promise<Chapter> {
  const title = written.title.trim().replace(/\s+/g, ' ');
  const body = written.body.trim();
  const words = countWords(body);
  const [existing] = await tx
    .select()
    .from(chapters)
    .where(and(eq(chapters.bookId, scene.bookId), eq(chapters.sceneId, scene.id)));
  let chapter: Chapter;
  if (existing) {
    chapter = await edit(tx, change, chapters, { id: existing.id }, { title, body, words });
  } else {
    chapter = await make(tx, change, chapters, { bookId: scene.bookId, sceneId: scene.id, number: scene.number, title, body, words });
  }
  await recountBook(tx, change, scene.bookId);
  return chapter;
}

/** Chapters a rewrite changed, their words counted again, and the book's. */
export async function recountChapters(tx: Tx, change: Change, ids: string[]) {
  for (const id of ids) {
    await recountChapter(tx, change, id);
  }
  await recountBook(tx, change, change.bookId);
}
