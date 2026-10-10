import type { Message } from '@writer/pi-ai';
import { and, asc, desc, eq, gte, inArray, max } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.ts';
import { sessionMessages, sessionSegments, turns } from '../db/schema.ts';
import type { Scene } from './scenes.ts';

/*
 * A scene's session: the chat Procreator plays it in, kept message by message as the model was
 * sent them and sent them back, so each call sends the same start as the one before and only the
 * end grows. It's kept in segments: each opens with a head (the brief, and after a compaction the
 * scene so far too) and goes on with the session's messages from its first kept one. The model is
 * sent the latest segment that still stands.
 *
 * Like turns, a session is raw history, not part of the change log: nothing in it is deleted. An
 * undo marks what it cut as undone, and a compaction starts a new segment beside the old.
 */

/**
 * play: the story. note: the owner telling Procreator of a change mid scene. fold: a compaction or
 * a wrap-up at work. aside: hints or openings the owner asked for. Folds and asides are kept for
 * the record and never sent again.
 */
export type MessageKind = 'play' | 'note' | 'fold' | 'aside';

export type Segment = typeof sessionSegments.$inferSelect;
export type SessionMessage = typeof sessionMessages.$inferSelect;

/** What a segment opens with, and where it picks the session up. */
export interface Opening {
  head: string;
  /** The scene so far, when the segment follows a compaction. */
  summary: string;
  /** The first of the session's messages it sends after the head. */
  fromSeq: number;
  /** The turn it's made at, so an undo past it cuts it too. */
  turnId: string | null;
}

/** A segment's message, with the number of the turn it belongs to. */
export interface Numbered {
  row: SessionMessage;
  message: Message;
  turn: number | null;
}

/** The scene's latest segment that still stands, or null before its session opens. */
export async function currentSegment(db: Db | Tx, sceneId: string): Promise<Segment | null> {
  const [segment] = await db
    .select()
    .from(sessionSegments)
    .where(and(eq(sessionSegments.sceneId, sceneId), eq(sessionSegments.undone, false)))
    .orderBy(desc(sessionSegments.number))
    .limit(1);
  if (!segment) {
    return null;
  }
  return segment;
}

/** Starts a segment: the session's first, or the next one after a compaction. */
export async function startSegment(db: Db | Tx, scene: Scene, opening: Opening): Promise<Segment> {
  const [row] = await db
    .select({ last: max(sessionSegments.number) })
    .from(sessionSegments)
    .where(eq(sessionSegments.sceneId, scene.id));
  const number = (row?.last ?? 0) + 1;
  const [segment] = await db
    .insert(sessionSegments)
    .values({ bookId: scene.bookId, sceneId: scene.id, number, ...opening })
    .returning();
  return segment;
}

/** The number the scene's session's next message gets. */
export async function nextSeq(db: Db | Tx, sceneId: string): Promise<number> {
  const [row] = await db
    .select({ last: max(sessionMessages.seq) })
    .from(sessionMessages)
    .where(eq(sessionMessages.sceneId, sceneId));
  return (row?.last ?? 0) + 1;
}

/** Adds a message at the end of the scene's session. */
export async function addMessage(
  db: Db | Tx,
  scene: Scene,
  kind: MessageKind,
  turnId: string | null,
  message: Message,
): Promise<SessionMessage> {
  // Undone messages keep their numbers, so a number always means one message.
  const seq = await nextSeq(db, scene.id);
  const [added] = await db
    .insert(sessionMessages)
    .values({ bookId: scene.bookId, sceneId: scene.id, seq, turnId, kind, message })
    .returning();
  return added;
}

/** What a segment goes on with after its head: the story and the owner's notes that still stand, in order, with their turns. */
export async function segmentMessages(db: Db | Tx, segment: Segment): Promise<Numbered[]> {
  const rows = await db
    .select({ row: sessionMessages, turn: turns.number })
    .from(sessionMessages)
    .leftJoin(turns, eq(turns.id, sessionMessages.turnId))
    .where(
      and(
        eq(sessionMessages.sceneId, segment.sceneId),
        eq(sessionMessages.undone, false),
        gte(sessionMessages.seq, segment.fromSeq),
        inArray(sessionMessages.kind, ['play', 'note']),
      ),
    )
    .orderBy(asc(sessionMessages.seq));
  return rows.map(({ row, turn }) => ({ row, message: row.message as Message, turn }));
}

/** Undo: the turns from this one on leave the scene's session, with the segments made at them. */
export async function cutSession(db: Db | Tx, sceneId: string, fromTurn: number) {
  const cut = db
    .select({ id: turns.id })
    .from(turns)
    .where(and(eq(turns.sceneId, sceneId), gte(turns.number, fromTurn)));
  await db
    .update(sessionMessages)
    .set({ undone: true })
    .where(and(eq(sessionMessages.sceneId, sceneId), inArray(sessionMessages.turnId, cut)));
  await db
    .update(sessionSegments)
    .set({ undone: true })
    .where(and(eq(sessionSegments.sceneId, sceneId), inArray(sessionSegments.turnId, cut)));
}
