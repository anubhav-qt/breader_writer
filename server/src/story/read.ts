import { and, asc, desc, eq } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.ts';
import { books, relationshipHistory, relationships, scenes, turns, worlds } from '../db/schema.ts';
import { castOf, type CharacterRow } from './cast.ts';
import { notesOf, type Note } from './memory.ts';
import { pagesOf, type Page } from './pages.ts';
import type { HistoryEntry } from './relationships.ts';
import type { Scene, Turn } from './scenes.ts';

/*
 * Everything a book's story knows, read from its tables in one go: what a session's brief is built
 * from (story/view.ts), when the session opens and again after a compaction.
 */

export type BookRow = typeof books.$inferSelect;
export type WorldRow = typeof worlds.$inferSelect;
export type RelationshipRow = typeof relationships.$inferSelect;
export type { CharacterRow };

export interface Story {
  book: BookRow;
  world: WorldRow | null;
  /** In cast order, the protagonist first. */
  characters: CharacterRow[];
  relationships: RelationshipRow[];
  history: HistoryEntry[];
  /** The reference, characters' pages included. */
  pages: Page[];
  /** Procreator's memory, oldest first. */
  notes: Note[];
  /** Every scene, in order. */
  scenes: Scene[];
}

export async function readStory(db: Db | Tx, bookId: string): Promise<Story> {
  const [book] = await db.select().from(books).where(eq(books.id, bookId));
  if (!book) {
    throw new Error(`There's no book ${bookId}.`);
  }
  const [world] = await db.select().from(worlds).where(eq(worlds.bookId, bookId));
  return {
    book,
    world: world ?? null,
    characters: await castOf(db, bookId),
    relationships: await db
      .select()
      .from(relationships)
      .where(eq(relationships.bookId, bookId))
      .orderBy(asc(relationships.aId), asc(relationships.bId)),
    history: await db.select().from(relationshipHistory).where(eq(relationshipHistory.bookId, bookId)).orderBy(asc(relationshipHistory.id)),
    pages: await pagesOf(db, bookId),
    notes: await notesOf(db, bookId),
    scenes: await db.select().from(scenes).where(eq(scenes.bookId, bookId)).orderBy(asc(scenes.number)),
  };
}

/** A scene's last turns that still stand, oldest first. */
export async function lastTurns(db: Db | Tx, sceneId: string, count: number): Promise<Turn[]> {
  const latest = await db
    .select()
    .from(turns)
    .where(and(eq(turns.sceneId, sceneId), eq(turns.undone, false)))
    .orderBy(desc(turns.number))
    .limit(count);
  return latest.reverse();
}
