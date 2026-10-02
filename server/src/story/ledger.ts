import { and, eq } from 'drizzle-orm';
import type { Tx } from '../db/client.ts';
import { arcs, characters, facts, growth, relationshipHistory, relationships, threads, timeline } from '../db/schema.ts';
import { edit, make, StoryError, type Change } from './changes.ts';
import { mentionsIn } from './mentions.ts';

/*
 * What the story keeps besides its scenes: the canon facts, the open threads, the timeline, what
 * characters have grown into, how relationships shift, and the arc. Each write is part of a
 * change (story/changes.ts), so it's tagged and can be taken back. The narrator's tools (step 4)
 * call these.
 */

export type Fact = typeof facts.$inferSelect;
export type Thread = typeof threads.$inferSelect;
export type TimelineEntry = typeof timeline.$inferSelect;
export type Growth = typeof growth.$inferSelect;
export type HistoryEntry = typeof relationshipHistory.$inferSelect;

async function castIds(tx: Tx, bookId: string): Promise<Set<string>> {
  const rows = await tx.select({ id: characters.id }).from(characters).where(eq(characters.bookId, bookId));
  return new Set(rows.map((row) => row.id));
}

/** Text the story keeps: not blank, and mentioning only people in the cast. */
async function checked(tx: Tx, bookId: string, text: string): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new StoryError('The text is empty. Say what it is.');
  }
  const cast = await castIds(tx, bookId);
  for (const id of mentionsIn(trimmed)) {
    if (!cast.has(id)) {
      throw new StoryError(`<@${id}> isn't anyone in the cast.`);
    }
  }
  return trimmed;
}

async function checkInCast(tx: Tx, bookId: string, id: string) {
  const cast = await castIds(tx, bookId);
  if (!cast.has(id)) {
    throw new StoryError(`${id} isn't anyone in the cast.`);
  }
}

/** Records something as true in the story, from the scene it came out of (null: before the story). */
export async function recordFact(tx: Tx, change: Change, sceneId: string | null, text: string): Promise<Fact> {
  const kept = await checked(tx, change.bookId, text);
  return make(tx, change, facts, { bookId: change.bookId, sceneId, text: kept });
}

export async function openThread(tx: Tx, change: Change, sceneId: string | null, text: string): Promise<Thread> {
  const kept = await checked(tx, change.bookId, text);
  return make(tx, change, threads, { bookId: change.bookId, openedIn: sceneId, text: kept });
}

/** Closes an open thread of the book's, saying how it was paid off. */
export async function closeThread(tx: Tx, change: Change, id: number, sceneId: string, outcome: string): Promise<Thread> {
  const [thread] = await tx
    .select()
    .from(threads)
    .where(and(eq(threads.id, id), eq(threads.bookId, change.bookId)));
  if (!thread) {
    throw new StoryError(`There's no thread ${id} in this book.`);
  }
  if (thread.closedIn !== null) {
    throw new StoryError(`Thread ${id} is closed already.`);
  }
  const kept = await checked(tx, change.bookId, outcome);
  return edit(tx, change, threads, { id }, { closedIn: sceneId, outcome: kept });
}

/** Adds what happened, and when in the story's own time. */
export async function addToTimeline(
  tx: Tx,
  change: Change,
  sceneId: string | null,
  when: string,
  what: string,
): Promise<TimelineEntry> {
  const keptWhen = await checked(tx, change.bookId, when);
  const keptWhat = await checked(tx, change.bookId, what);
  return make(tx, change, timeline, { bookId: change.bookId, sceneId, when: keptWhen, what: keptWhat });
}

/** Adds to a character's sheet what the story has made of them. */
export async function addGrowth(
  tx: Tx,
  change: Change,
  characterId: string,
  sceneId: string | null,
  text: string,
): Promise<Growth> {
  await checkInCast(tx, change.bookId, characterId);
  const kept = await checked(tx, change.bookId, text);
  return make(tx, change, growth, { bookId: change.bookId, characterId, sceneId, text: kept });
}

/** One person's side of a relationship, changed. */
export interface SideShift {
  id: string;
  sees?: string;
  hides?: string;
}

/** A relationship changing: its bond, either side, and what happened, for its history. */
export interface Shift {
  /** The two people, by id, either way round. */
  one: string;
  other: string;
  bond?: string;
  sides?: SideShift[];
  /** What changed and why ("<@id> stops trusting her after the trial"). */
  what: string;
}

type RelationshipSet = Partial<typeof relationships.$inferInsert>;

/** The columns a shift sets, with the pair's smaller id as side a, as the line is stored. */
function shiftedColumns(shift: Shift, aId: string): RelationshipSet {
  const set: RelationshipSet = {};
  if (shift.bond !== undefined) {
    set.bond = shift.bond.trim();
  }
  for (const side of shift.sides ?? []) {
    const isA = side.id === aId;
    if (side.sees !== undefined) {
      if (isA) {
        set.aSees = side.sees.trim();
      } else {
        set.bSees = side.sees.trim();
      }
    }
    if (side.hides !== undefined) {
      if (isA) {
        set.aHides = side.hides.trim();
      } else {
        set.bHides = side.hides.trim();
      }
    }
  }
  return set;
}

/**
 * Shifts the relationship between two people, tying them first if they weren't, and adds what
 * happened to its history.
 */
export async function shiftRelationship(tx: Tx, change: Change, sceneId: string | null, shift: Shift): Promise<HistoryEntry> {
  if (shift.one === shift.other) {
    throw new StoryError('A relationship is between two different people.');
  }
  await checkInCast(tx, change.bookId, shift.one);
  await checkInCast(tx, change.bookId, shift.other);
  for (const side of shift.sides ?? []) {
    if (side.id !== shift.one && side.id !== shift.other) {
      throw new StoryError(`${side.id} isn't one of the two in this relationship.`);
    }
  }
  const what = await checked(tx, change.bookId, shift.what);

  let aId = shift.one;
  let bId = shift.other;
  if (bId < aId) {
    aId = shift.other;
    bId = shift.one;
  }
  const key = { bookId: change.bookId, aId, bId };
  const set = shiftedColumns(shift, aId);
  const [line] = await tx
    .select()
    .from(relationships)
    .where(and(eq(relationships.bookId, key.bookId), eq(relationships.aId, aId), eq(relationships.bId, bId)));
  if (!line) {
    await make(tx, change, relationships, { ...key, ...set });
  } else if (Object.keys(set).length > 0) {
    await edit(tx, change, relationships, key, set);
  }
  return make(tx, change, relationshipHistory, { ...key, sceneId, text: what });
}

/** Writes where the story is heading, replacing the plan before it (which the log keeps). */
export async function setArc(tx: Tx, change: Change, plan: string) {
  const kept = await checked(tx, change.bookId, plan);
  const [arc] = await tx.select().from(arcs).where(eq(arcs.bookId, change.bookId));
  if (!arc) {
    return make(tx, change, arcs, { bookId: change.bookId, plan: kept });
  }
  return edit(tx, change, arcs, { bookId: change.bookId }, { plan: kept });
}
