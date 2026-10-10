import type { Message } from '@writer/pi-ai';
import { and, asc, desc, eq, gte, inArray, isNotNull, max } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.ts';
import { actorMessages, actorSegments, turns } from '../db/schema.ts';

/*
 * An actor's chat: the chat a cast member's actor plays them in, across every scene they're in
 * (see "Actors" in CLAUDE.md). It's kept as a scene's session is (story/session.ts): message by
 * message as the model was sent them and sent them back, only ever added to, so each call sends
 * the same start as the one before. It's kept in segments, each opening with a head (who they
 * are, and after a compaction what they remember), and an undo marks what it cut as undone.
 *
 * It holds only their side of the story: what Procreator told them they saw and heard, and what
 * they did. The database stays the memory; the chat is a working copy of it.
 */

/** play: a cue, a note, an answer. fold: a compaction at work, kept for the record and never sent again. */
export type ActorKind = 'play' | 'fold';

export type ActorSegment = typeof actorSegments.$inferSelect;
export type ActorMessage = typeof actorMessages.$inferSelect;

/** Whose chat: a cast member of a book. */
export interface Actor {
  bookId: string;
  characterId: string;
}

/** What an actor's segment opens with, and where it picks the chat up. */
export interface ActorOpening {
  head: string;
  /** Who they are as the head tells them. */
  self: string;
  /** What they remember of the chat before fromSeq, after a compaction. */
  memory: string;
  fromSeq: number;
  /** The turn it's made at, so an undo past it cuts it too. Null when a rewrite of the past made it, which an undo leaves. */
  turnId: string | null;
}

/** A message to keep in an actor's chat. */
export interface ActorEntry {
  kind: ActorKind;
  turnId: string;
  sceneId: string;
  message: Message;
  /** Who they are, when the message told them what changed about them. */
  self: string | null;
}

/** A segment's message, with the number of the turn it belongs to. */
export interface ActorNumbered {
  row: ActorMessage;
  message: Message;
  turn: number;
}

function ofActor(actor: Actor) {
  return and(eq(actorSegments.bookId, actor.bookId), eq(actorSegments.characterId, actor.characterId));
}

function messagesOfActor(actor: Actor) {
  return and(eq(actorMessages.bookId, actor.bookId), eq(actorMessages.characterId, actor.characterId));
}

/** The actor's latest segment that still stands, or null before their chat starts. */
export async function currentActorSegment(db: Db | Tx, actor: Actor): Promise<ActorSegment | null> {
  const [segment] = await db
    .select()
    .from(actorSegments)
    .where(and(ofActor(actor), eq(actorSegments.undone, false)))
    .orderBy(desc(actorSegments.number))
    .limit(1);
  if (!segment) {
    return null;
  }
  return segment;
}

/** Starts a segment: the chat's first, or the next one after a compaction. */
export async function startActorSegment(db: Db | Tx, actor: Actor, opening: ActorOpening): Promise<ActorSegment> {
  const [row] = await db
    .select({ last: max(actorSegments.number) })
    .from(actorSegments)
    .where(ofActor(actor));
  const number = (row?.last ?? 0) + 1;
  const [segment] = await db
    .insert(actorSegments)
    .values({ ...actor, number, ...opening })
    .returning();
  return segment;
}

/** The number the actor's chat's next message gets. */
export async function nextActorSeq(db: Db | Tx, actor: Actor): Promise<number> {
  const [row] = await db
    .select({ last: max(actorMessages.seq) })
    .from(actorMessages)
    .where(messagesOfActor(actor));
  return (row?.last ?? 0) + 1;
}

/** Adds a message at the end of the actor's chat. */
export async function addActorMessage(db: Db | Tx, actor: Actor, entry: ActorEntry): Promise<ActorMessage> {
  // Undone messages keep their numbers, so a number always means one message.
  const seq = await nextActorSeq(db, actor);
  const [added] = await db
    .insert(actorMessages)
    .values({ ...actor, seq, ...entry })
    .returning();
  return added;
}

/** What a segment goes on with after its head: the messages that still stand, in order, with their turns. */
export async function actorSegmentMessages(db: Db | Tx, segment: ActorSegment): Promise<ActorNumbered[]> {
  const rows = await db
    .select({ row: actorMessages, turn: turns.number })
    .from(actorMessages)
    .innerJoin(turns, eq(turns.id, actorMessages.turnId))
    .where(
      and(
        messagesOfActor(segment),
        eq(actorMessages.undone, false),
        gte(actorMessages.seq, segment.fromSeq),
        eq(actorMessages.kind, 'play'),
      ),
    )
    .orderBy(asc(actorMessages.seq));
  return rows.map(({ row, turn }) => ({ row, message: row.message as Message, turn }));
}

/** Who the actor was last told they are: by the newest message in the segment that told them, else its head. */
export async function lastSelf(db: Db | Tx, segment: ActorSegment): Promise<string> {
  const [told] = await db
    .select({ self: actorMessages.self })
    .from(actorMessages)
    .where(
      and(
        messagesOfActor(segment),
        eq(actorMessages.undone, false),
        gte(actorMessages.seq, segment.fromSeq),
        isNotNull(actorMessages.self),
      ),
    )
    .orderBy(desc(actorMessages.seq))
    .limit(1);
  if (told?.self) {
    return told.self;
  }
  return segment.self;
}

/** The scene the actor was last cued in, or null before their first cue. */
export async function lastSceneOf(db: Db | Tx, actor: Actor): Promise<string | null> {
  const [row] = await db
    .select({ sceneId: actorMessages.sceneId })
    .from(actorMessages)
    .where(and(messagesOfActor(actor), eq(actorMessages.undone, false), eq(actorMessages.kind, 'play')))
    .orderBy(desc(actorMessages.seq))
    .limit(1);
  if (!row) {
    return null;
  }
  return row.sceneId;
}

/** Undo: the turns from this one on leave every actor's chat, with the segments made at them. */
export async function cutActors(db: Db | Tx, sceneId: string, fromTurn: number) {
  const cut = db
    .select({ id: turns.id })
    .from(turns)
    .where(and(eq(turns.sceneId, sceneId), gte(turns.number, fromTurn)));
  await db.update(actorMessages).set({ undone: true }).where(inArray(actorMessages.turnId, cut));
  await db.update(actorSegments).set({ undone: true }).where(inArray(actorSegments.turnId, cut));
}
