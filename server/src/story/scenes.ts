import { and, asc, desc, eq, gt, max } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.ts';
import { scenes, turns } from '../db/schema.ts';
import { edit, make, StoryError, type Change } from './changes.ts';

/*
 * Scenes and their turns. A book plays one scene at a time; when the place or time shifts, the
 * scene ends, folds into its summary (procreator/folds.ts) and is written into the book. The scene
 * after it is made as it ends, and waits as next until the owner goes on to it.
 *
 * Nothing outside the story's own modules calls these: breading_ground is the door to them.
 *
 * Turns are the story's raw history, word for word: a turn is what changes are tagged with, so
 * making one isn't a change. Rewriting one is (a reply asked for again, a rename reaching back),
 * so the words it replaced are kept.
 */

export type Scene = typeof scenes.$inferSelect;
export type Turn = typeof turns.$inferSelect;

/**
 * As someone in the cast, as the author (a note the story follows and never says), Procreator
 * opening the scene, or someone's actor playing them when the owner let it.
 */
export type Voice = 'character' | 'author' | 'opening' | 'actor';

/**
 * Someone in the cast about to act, when Procreator stopped the turn for the owner to say who
 * plays them this time: who, by id, and what Procreator told them they see and know now.
 */
export interface Cue {
  who: string;
  sees: string;
}

/** The cue a turn stopped at, or null. */
export function cueOf(turn: Turn): Cue | null {
  if (!turn.cue) {
    return null;
  }
  return turn.cue as Cue;
}

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

/** The scene waiting for the owner to go on to it, or null. */
export async function nextScene(db: Db | Tx, bookId: string): Promise<Scene | null> {
  const [scene] = await db
    .select()
    .from(scenes)
    .where(and(eq(scenes.bookId, bookId), eq(scenes.status, 'next')));
  if (!scene) {
    return null;
  }
  return scene;
}

/** A scene as it stands now. */
export async function sceneNow(db: Db | Tx, id: string): Promise<Scene> {
  const [scene] = await db.select().from(scenes).where(eq(scenes.id, id));
  if (!scene) {
    throw new StoryError("That scene isn't in the story.");
  }
  return scene;
}

/** A scene as it stands now, held until the transaction ends, so no one else changes it meanwhile. */
export async function lockedScene(tx: Tx, id: string): Promise<Scene> {
  const [scene] = await tx.select().from(scenes).where(eq(scenes.id, id)).for('update');
  if (!scene) {
    throw new StoryError("That scene isn't in the story.");
  }
  return scene;
}

/** Makes the book's next scene, waiting for the owner to go on to it. */
export async function prepareScene(tx: Tx, change: Change, opening: Opening): Promise<Scene> {
  const waiting = await nextScene(tx, change.bookId);
  if (waiting) {
    throw new StoryError(`Scene ${waiting.number} is waiting to begin already.`);
  }
  const number = (await lastSceneNumber(tx, change.bookId)) + 1;
  return make(tx, change, scenes, {
    bookId: change.bookId,
    number,
    place: opening.place,
    time: opening.time,
    present: opening.present,
    status: 'next',
  });
}

/** The scene waiting as next begins: it's the one being played. */
export async function beginScene(tx: Tx, change: Change, scene: Scene): Promise<Scene> {
  if (scene.status !== 'next') {
    throw new StoryError(`Scene ${scene.number} isn't waiting to begin.`);
  }
  const playing = await playingScene(tx, change.bookId);
  if (playing) {
    throw new StoryError(`Scene ${playing.number} is still playing. End it first.`);
  }
  return edit(tx, change, scenes, { id: scene.id }, { status: 'playing' });
}

/** Changes where and when a scene is, who is in it, or the openings offered for it. */
export async function reframeScene(
  tx: Tx,
  change: Change,
  scene: Scene,
  set: Partial<Pick<Scene, 'place' | 'time' | 'present' | 'openings'>>,
): Promise<Scene> {
  if (scene.status === 'ended') {
    throw new StoryError(`Scene ${scene.number} has ended.`);
  }
  return edit(tx, change, scenes, { id: scene.id }, set);
}

/** Ends the scene being played. Folding it comes after (procreator/folds.ts). */
export async function endScene(tx: Tx, change: Change, scene: Scene): Promise<Scene> {
  if (scene.status !== 'playing') {
    throw new StoryError(`Scene ${scene.number} has already ended.`);
  }
  return edit(tx, change, scenes, { id: scene.id }, { status: 'ended' });
}

/** Keeps an ended scene's summary. */
export async function summarize(tx: Tx, change: Change, scene: Scene, summary: string): Promise<Scene> {
  if (scene.status !== 'ended') {
    throw new StoryError(`Scene ${scene.number} is still playing. End it before it's summed up.`);
  }
  return edit(tx, change, scenes, { id: scene.id }, { summary });
}

async function lastTurnNumber(db: Db | Tx, bookId: string): Promise<number> {
  const [row] = await db
    .select({ last: max(turns.number) })
    .from(turns)
    .where(eq(turns.bookId, bookId));
  return row?.last ?? 0;
}

/** The owner's move, as a new turn in the scene being played. `played` is who they played, for a character's move. */
export async function addTurn(db: Db | Tx, scene: Scene, voice: Voice, input: string, played: string | null = null): Promise<Turn> {
  if (scene.status !== 'playing') {
    throw new StoryError(`Scene ${scene.number} isn't being played, so it takes no turns.`);
  }
  const number = (await lastTurnNumber(db, scene.bookId)) + 1;
  const [turn] = await db.insert(turns).values({ bookId: scene.bookId, sceneId: scene.id, number, voice, played, input }).returning();
  return turn;
}

/** Marks a turn taken back. It's kept, and left out of the story. */
export async function markUndone(db: Db | Tx, turn: Turn): Promise<Turn> {
  const [undone] = await db.update(turns).set({ undone: true }).where(eq(turns.id, turn.id)).returning();
  return undone;
}

/** The book's newest turn that still stands, in any scene, or null before anything is played. */
export async function newestInBook(db: Db | Tx, bookId: string): Promise<Turn | null> {
  const [turn] = await db
    .select()
    .from(turns)
    .where(and(eq(turns.bookId, bookId), eq(turns.undone, false)))
    .orderBy(desc(turns.number))
    .limit(1);
  if (!turn) {
    return null;
  }
  return turn;
}

/** A scene's newest turn that still stands, or null. */
export async function newestTurn(db: Db | Tx, sceneId: string): Promise<Turn | null> {
  const [turn] = await db
    .select()
    .from(turns)
    .where(and(eq(turns.sceneId, sceneId), eq(turns.undone, false)))
    .orderBy(desc(turns.number))
    .limit(1);
  if (!turn) {
    return null;
  }
  return turn;
}

/**
 * The narrator's reply, the first time it's written, and the cue it stopped at, if it stopped for
 * the owner. Writing it again is a rewrite, and a change.
 */
export async function setReply(db: Db | Tx, turn: Turn, reply: string, cue: Cue | null = null): Promise<Turn> {
  const [written] = await db
    .update(turns)
    .set({ reply, cue })
    .where(and(eq(turns.id, turn.id), eq(turns.reply, ''), eq(turns.undone, false)))
    .returning();
  if (!written) {
    throw new StoryError(`Turn ${turn.number} has its reply already.`);
  }
  return written;
}

/** An actor's turn's words: the actor's answer, once it comes, the first time. */
export async function setInput(db: Db | Tx, turn: Turn, input: string): Promise<Turn> {
  const [written] = await db
    .update(turns)
    .set({ input })
    .where(and(eq(turns.id, turn.id), eq(turns.voice, 'actor'), eq(turns.input, '')))
    .returning();
  if (!written) {
    throw new StoryError(`Turn ${turn.number} has its words already.`);
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
