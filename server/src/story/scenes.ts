import { and, asc, eq, gt, max } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.ts';
import { scenes, turns } from '../db/schema.ts';
import { edit, make, StoryError, type Change } from './changes.ts';

/*
 * Scenes and their turns. A book plays one scene at a time; when the place or time shifts, the
 * scene ends, folds into its summary (story/fold.ts) and is written into the book.
 *
 * Turns are the story's raw history, word for word: a turn is what changes are tagged with, so
 * making one isn't a change. Rewriting one is (a reply asked for again, a rename reaching back),
 * so the words it replaced are kept.
 */

export type Scene = typeof scenes.$inferSelect;
export type Turn = typeof turns.$inferSelect;

/** As the protagonist, or as the author: a note the story follows and never says. */
export type Voice = 'character' | 'author';

/** Where a scene opens and who is in it. */
export interface Opening {
  place: string;
  time: string;
  /** Character ids. */
  present: string[];
}

/** The scene being played, or null between scenes and before the first. */
export async function playingScene(db: Db | Tx, bookId: string): Promise<Scene | null> {
  const [scene] = await db
    .select()
    .from(scenes)
    .where(and(eq(scenes.bookId, bookId), eq(scenes.status, 'playing')));
  if (!scene) {
    return null;
  }
  return scene;
}

async function lastSceneNumber(tx: Tx, bookId: string): Promise<number> {
  const [row] = await tx
    .select({ last: max(scenes.number) })
    .from(scenes)
    .where(eq(scenes.bookId, bookId));
  return row?.last ?? 0;
}

/** Starts the book's next scene. The one before has to have ended. */
export async function startScene(tx: Tx, change: Change, opening: Opening): Promise<Scene> {
  const playing = await playingScene(tx, change.bookId);
  if (playing) {
    throw new StoryError(`Scene ${playing.number} is still playing. End it first.`);
  }
  const number = (await lastSceneNumber(tx, change.bookId)) + 1;
  return make(tx, change, scenes, {
    bookId: change.bookId,
    number,
    place: opening.place,
    time: opening.time,
    present: opening.present,
  });
}

/** Ends the scene being played. Folding it comes after (story/fold.ts). */
export async function endScene(tx: Tx, change: Change, scene: Scene): Promise<Scene> {
  if (scene.status !== 'playing') {
    throw new StoryError(`Scene ${scene.number} has already ended.`);
  }
  return edit(tx, change, scenes, { id: scene.id }, { status: 'ended' });
}

async function lastTurnNumber(db: Db | Tx, bookId: string): Promise<number> {
  const [row] = await db
    .select({ last: max(turns.number) })
    .from(turns)
    .where(eq(turns.bookId, bookId));
  return row?.last ?? 0;
}

/** The owner's move, as a new turn in the scene being played. */
export async function addTurn(db: Db | Tx, scene: Scene, voice: Voice, input: string): Promise<Turn> {
  if (scene.status !== 'playing') {
    throw new StoryError(`Scene ${scene.number} has ended, so it takes no more turns.`);
  }
  const number = (await lastTurnNumber(db, scene.bookId)) + 1;
  const [turn] = await db.insert(turns).values({ bookId: scene.bookId, sceneId: scene.id, number, voice, input }).returning();
  return turn;
}

/** The narrator's reply, the first time it's written. Writing it again is a rewrite, and a change. */
export async function setReply(db: Db | Tx, turn: Turn, reply: string): Promise<Turn> {
  const [written] = await db
    .update(turns)
    .set({ reply })
    .where(and(eq(turns.id, turn.id), eq(turns.reply, '')))
    .returning();
  if (!written) {
    throw new StoryError(`Turn ${turn.number} has its reply already.`);
  }
  return written;
}

/** A scene's turns that still stand (not undone), in order, after the given turn number. */
export async function turnsOf(db: Db | Tx, sceneId: string, after = 0): Promise<Turn[]> {
  return db
    .select()
    .from(turns)
    .where(and(eq(turns.sceneId, sceneId), eq(turns.undone, false), gt(turns.number, after)))
    .orderBy(asc(turns.number));
}
