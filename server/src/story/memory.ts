import { and, asc, eq } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.ts';
import { notes } from '../db/schema.ts';
import { castByName } from './cast.ts';
import { make, remove, startChange, StoryError, type Writer } from './changes.ts';
import { unlinked } from './mentions.ts';

/*
 * Procreator's memory: its notes to itself about the work, kept across scenes. What the owner likes
 * and doesn't, what they've asked for that still holds, what Procreator has learned about writing
 * this book. What happens in the story belongs in the reference instead. Every brief holds all of
 * it, so it's kept short. Each note made or forgotten is a change, like any other.
 */

export const MAX_NOTES = 40;
export const NOTE_CHARS = 300;

export type Note = typeof notes.$inferSelect;

/** A book's notes, oldest first. */
export async function notesOf(db: Db | Tx, bookId: string): Promise<Note[]> {
  return db.select().from(notes).where(eq(notes.bookId, bookId)).orderBy(asc(notes.id));
}

/** A note as it's kept: one line, with links turned into mentions. */
async function cleanNote(tx: Tx, bookId: string, text: string): Promise<string> {
  const line = text.trim().replace(/\s+/g, ' ');
  if (!line) {
    throw new StoryError('The note is empty. Say what to remember.');
  }
  if (line.length > NOTE_CHARS) {
    throw new StoryError(`A note is at most ${NOTE_CHARS} characters, and this is ${line.length}. Say it shorter, or make it two notes.`);
  }
  const cast = await castByName(tx, bookId);
  return unlinked(line, cast);
}

/** Keeps a note. The same note again, in any case, gives back the one kept already. */
export async function remember(tx: Tx, writer: Writer, text: string): Promise<{ note: Note; made: boolean }> {
  const kept = await cleanNote(tx, writer.bookId, text);
  const existing = await notesOf(tx, writer.bookId);
  const same = existing.find((note) => note.text.toLowerCase() === kept.toLowerCase());
  if (same) {
    return { note: same, made: false };
  }
  if (existing.length >= MAX_NOTES) {
    throw new StoryError(
      `Your memory is full: it holds ${MAX_NOTES} notes. Forget one that no longer holds, or fold two into one, first.`,
    );
  }
  const change = await startChange(tx, { ...writer, what: 'Remembered a note' });
  const note = await make(tx, change, notes, { bookId: writer.bookId, text: kept });
  return { note, made: true };
}

/** Drops a note of the book's. */
export async function forget(tx: Tx, writer: Writer, id: number): Promise<Note> {
  const [note] = await tx
    .select()
    .from(notes)
    .where(and(eq(notes.id, id), eq(notes.bookId, writer.bookId)));
  if (!note) {
    throw new StoryError(`There's no note ${id} in your memory. Use the number your brief or remember gave it.`);
  }
  const change = await startChange(tx, { ...writer, what: `Forgot note ${id}` });
  await remove(tx, change, notes, { id });
  return note;
}
