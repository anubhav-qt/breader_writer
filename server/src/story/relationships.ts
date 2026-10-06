import { and, desc, eq } from 'drizzle-orm';
import type { Tx } from '../db/client.ts';
import { characters, relationshipHistory, relationships } from '../db/schema.ts';
import { edit, make, startChange, StoryError, type Change, type Writer } from './changes.ts';
import { mentionsIn } from './mentions.ts';

/*
 * How relationships shift as the story goes: the line between two people changes (its bond,
 * either side), tying them first if they weren't, and what happened goes into the line's history.
 * Each shift is part of a change, so it's tagged and can be taken back.
 */

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

type RelationshipRow = typeof relationships.$inferSelect;
type RelationshipSet = Partial<typeof relationships.$inferInsert>;

/** The pair as the line is stored: the smaller id first. */
function inOrder(shift: Shift): { aId: string; bId: string } {
  if (shift.other < shift.one) {
    return { aId: shift.other, bId: shift.one };
  }
  return { aId: shift.one, bId: shift.other };
}

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

  const { aId, bId } = inOrder(shift);
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

/** Whether the line already says everything the shift sets. */
function saysAlready(line: RelationshipRow, set: RelationshipSet): boolean {
  for (const [column, value] of Object.entries(set)) {
    if (line[column as keyof RelationshipRow] !== value) {
      return false;
    }
  }
  return true;
}

/** Whether this shift is in place already: the line says it, and it's the latest in their history, from this scene. */
async function isShifted(tx: Tx, bookId: string, sceneId: string | null, shift: Shift): Promise<boolean> {
  const { aId, bId } = inOrder(shift);
  const [line] = await tx
    .select()
    .from(relationships)
    .where(and(eq(relationships.bookId, bookId), eq(relationships.aId, aId), eq(relationships.bId, bId)));
  if (!line) {
    return false;
  }
  if (!saysAlready(line, shiftedColumns(shift, aId))) {
    return false;
  }
  const [latest] = await tx
    .select()
    .from(relationshipHistory)
    .where(and(eq(relationshipHistory.bookId, bookId), eq(relationshipHistory.aId, aId), eq(relationshipHistory.bId, bId)))
    .orderBy(desc(relationshipHistory.id))
    .limit(1);
  if (!latest) {
    return false;
  }
  return latest.sceneId === sceneId && latest.text === shift.what.trim();
}

/** Shifts a relationship as a change of its own, or does nothing when it's so already (the same shift sent twice). */
export async function shiftOnce(tx: Tx, writer: Writer, sceneId: string | null, shift: Shift): Promise<HistoryEntry | null> {
  if (await isShifted(tx, writer.bookId, sceneId, shift)) {
    return null;
  }
  const change = await startChange(tx, { ...writer, what: 'Shifted a relationship', why: shift.what.trim() });
  return shiftRelationship(tx, change, sceneId, shift);
}
