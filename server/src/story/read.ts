import { and, asc, eq, gt } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.ts';
import {
  arcs,
  books,
  characters,
  facts,
  growth,
  relationshipHistory,
  relationships,
  scenes,
  threads,
  timeline,
  turns,
  worlds,
} from '../db/schema.ts';
import type { Fact, Growth, HistoryEntry, Thread, TimelineEntry } from './ledger.ts';
import type { Scene, Turn } from './scenes.ts';

/*
 * Everything a book's story knows, read from its tables in one go. The working context is built
 * from this for every call (story/view.ts), so the model never leans on something that only lived
 * in an old message.
 */

export type BookRow = typeof books.$inferSelect;
export type WorldRow = typeof worlds.$inferSelect;
export type CharacterRow = typeof characters.$inferSelect;
export type RelationshipRow = typeof relationships.$inferSelect;

/** A scene, and its turns not yet folded into its summary. */
export interface SceneState {
  scene: Scene;
  unfolded: Turn[];
}

export interface Story {
  book: BookRow;
  world: WorldRow | null;
  /** In cast order, the protagonist first. */
  characters: CharacterRow[];
  relationships: RelationshipRow[];
  history: HistoryEntry[];
  growth: Growth[];
  facts: Fact[];
  threads: Thread[];
  timeline: TimelineEntry[];
  arc: string;
  /** Every scene, in order. */
  scenes: SceneState[];
}

/** Turns that still stand and haven't been folded, by scene. */
async function unfoldedTurns(db: Db | Tx, bookId: string): Promise<Map<string, Turn[]>> {
  const rows = await db
    .select({ turn: turns })
    .from(turns)
    .innerJoin(scenes, eq(scenes.id, turns.sceneId))
    .where(and(eq(turns.bookId, bookId), eq(turns.undone, false), gt(turns.number, scenes.foldedThrough)))
    .orderBy(asc(turns.number));
  const byScene = new Map<string, Turn[]>();
  for (const { turn } of rows) {
    const list = byScene.get(turn.sceneId) ?? [];
    list.push(turn);
    byScene.set(turn.sceneId, list);
  }
  return byScene;
}

export async function readStory(db: Db | Tx, bookId: string): Promise<Story> {
  const [book] = await db.select().from(books).where(eq(books.id, bookId));
  if (!book) {
    throw new Error(`There's no book ${bookId}.`);
  }
  const [world] = await db.select().from(worlds).where(eq(worlds.bookId, bookId));
  const [arc] = await db.select().from(arcs).where(eq(arcs.bookId, bookId));
  const sceneRows = await db.select().from(scenes).where(eq(scenes.bookId, bookId)).orderBy(asc(scenes.number));
  const unfolded = await unfoldedTurns(db, bookId);

  return {
    book,
    world: world ?? null,
    characters: await db.select().from(characters).where(eq(characters.bookId, bookId)).orderBy(asc(characters.position)),
    relationships: await db
      .select()
      .from(relationships)
      .where(eq(relationships.bookId, bookId))
      .orderBy(asc(relationships.aId), asc(relationships.bId)),
    history: await db.select().from(relationshipHistory).where(eq(relationshipHistory.bookId, bookId)).orderBy(asc(relationshipHistory.id)),
    growth: await db.select().from(growth).where(eq(growth.bookId, bookId)).orderBy(asc(growth.id)),
    facts: await db.select().from(facts).where(eq(facts.bookId, bookId)).orderBy(asc(facts.id)),
    threads: await db.select().from(threads).where(eq(threads.bookId, bookId)).orderBy(asc(threads.id)),
    timeline: await db.select().from(timeline).where(eq(timeline.bookId, bookId)).orderBy(asc(timeline.id)),
    arc: arc?.plan ?? '',
    scenes: sceneRows.map((scene) => ({ scene, unfolded: unfolded.get(scene.id) ?? [] })),
  };
}
