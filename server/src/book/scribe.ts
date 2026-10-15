import { and, asc, eq, ne } from 'drizzle-orm';
import { newestChange, writeChapter } from '../breading_ground.ts';
import type { Db } from '../db/client.ts';
import { chapters, scenes } from '../db/schema.ts';
import { log } from '../log.ts';
import { writeUp } from '../procreator/author.ts';
import type { Procreator } from '../procreator/run.ts';
import { lastTurns } from '../story/read.ts';
import type { Scene } from '../story/scenes.ts';

/*
 * The scribe: it writes the book as the play goes (step 7). Once a scene is wrapped up (the owner
 * went on from it, so it can't be taken back), Procreator writes it into the book as a chapter, in
 * the background, so the book trails the play by a few minutes and the play never waits for it.
 * Chapters are written in order, each with the one before in view. One book is written at a time
 * by one server, as play is. A chapter that fails is written again the next time the scribe is
 * nudged; one read before a change that rewrote the past is written again at once.
 */

/** Who writes the book in the background, so tests can do without. */
export interface Scribe {
  /**
   * Writes what's missing from the book, on this Procreator, unless it's writing in the book
   * already: every chapter, or only those up to the scene `through` (the house's free chapter).
   */
  nudge: (ai: Procreator, bookId: string, through?: number) => void;
  /** Whether it's writing in the book now. */
  busy: (bookId: string) => boolean;
}

/** The book's first scene that's wrapped up and not written yet, or null. */
async function nextToWrite(db: Db, bookId: string): Promise<Scene | null> {
  const waiting = await db
    .select({ scene: scenes, chapter: chapters.id })
    .from(scenes)
    .leftJoin(chapters, eq(chapters.sceneId, scenes.id))
    .where(and(eq(scenes.bookId, bookId), eq(scenes.status, 'ended'), ne(scenes.summary, '')))
    .orderBy(asc(scenes.number));
  const first = waiting.find((row) => row.chapter === null);
  if (!first) {
    return null;
  }
  return first.scene;
}

/**
 * Writes every scene that's wrapped up and not in the book yet, oldest first, up to the scene
 * `through`. Answers with how many chapters it kept. Throws what the author's call throws; what
 * was kept before stays kept.
 */
export async function writeMissing(ai: Procreator, bookId: string, through = Number.POSITIVE_INFINITY): Promise<number> {
  let kept = 0;
  for (;;) {
    const scene = await nextToWrite(ai.db, bookId);
    if (!scene || scene.number > through) {
      return kept;
    }
    const since = await newestChange(ai.db, bookId);
    const written = await writeUp(ai, scene);
    const [last] = await lastTurns(ai.db, scene.id, 1);
    const turnId = last?.id ?? null;
    const chapter = await writeChapter(ai.db, { bookId, turnId, by: 'agent' }, scene, written, since);
    // Null when the owner's change rewrote the past meanwhile: the loop writes it again from the story as it now reads.
    if (chapter) {
      kept += 1;
    }
  }
}

/** The scribe the server runs: one book at a time each, in the background. */
export function backgroundScribe(): Scribe {
  const writing = new Set<string>();
  // Books nudged while they were being written: there may be more to write once it's done.
  const again = new Set<string>();

  const run = async (ai: Procreator, bookId: string, through: number | undefined) => {
    try {
      do {
        again.delete(bookId);
        await writeMissing(ai, bookId, through);
      } while (again.has(bookId));
    } catch (err) {
      log.warn({ err, bookId }, 'a chapter couldn’t be written; it’s tried again next time');
    } finally {
      writing.delete(bookId);
    }
  };

  return {
    nudge: (ai, bookId, through) => {
      if (writing.has(bookId)) {
        again.add(bookId);
        return;
      }
      writing.add(bookId);
      // Not the request's: the book is written whether or not anyone is still waiting.
      const own: Procreator = { ...ai, signal: undefined };
      void run(own, bookId, through);
    },
    busy: (bookId) => writing.has(bookId),
  };
}
