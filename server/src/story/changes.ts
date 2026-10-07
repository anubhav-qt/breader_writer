import { and, asc, desc, eq, getTableColumns, getTableName, gt, isNull, ne, notExists, sql, type SQL } from 'drizzle-orm';
import { alias, getTableConfig, type PgColumn } from 'drizzle-orm/pg-core';
import type { Db, Tx } from '../db/client.ts';
import {
  changes,
  characters,
  notes,
  pages,
  relationshipHistory,
  relationships,
  scenes,
  turns,
  versions,
  worlds,
} from '../db/schema.ts';

/*
 * The change log. Every change to the story is one row in changes, tagged with who made it (the
 * owner or the agent) and the turn it came from, and every row it makes, edits or removes keeps
 * a version: what it was before and after. Nothing is lost, so a change can be looked over and
 * taken back, and undo can roll the story back along with its turns.
 */

export type Who = 'owner' | 'agent';

/** Who makes a change, at which turn, and what it is. */
export interface Tag {
  bookId: string;
  /** The turn being played, or the latest when the owner changes something between turns. Null before the first. */
  turnId: string | null;
  by: Who;
  /** What it does, in a few words ("Wrote the page The Keep"). */
  what: string;
  why?: string;
}

/** Who makes a change, and at which turn, for writes that say for themselves what they did. */
export type Writer = Omit<Tag, 'what'>;

export type Change = typeof changes.$inferSelect;
export type Version = typeof versions.$inferSelect;

/** A row as the log keeps it: by column, as drizzle names them. */
type Row = Record<string, unknown>;

/** Something the story asked of the log that it can't do, said so the caller can tell the owner or the model. */
export class StoryError extends Error {}

const STORY_TABLES = [scenes, turns, pages, notes, relationshipHistory, worlds, characters, relationships];

export type StoryTable = (typeof STORY_TABLES)[number];

function byName(): Map<string, StoryTable> {
  const tables = new Map<string, StoryTable>();
  for (const table of STORY_TABLES) {
    tables.set(getTableName(table), table);
  }
  return tables;
}

const TABLES = byName();

function tableNamed(name: string): StoryTable {
  const table = TABLES.get(name);
  if (!table) {
    throw new Error(`The change log has a version of ${name}, which isn't one of the story's tables.`);
  }
  return table;
}

/** The names of a table's primary key columns. */
function keyColumns(table: StoryTable): string[] {
  const primary = new Set<string>();
  const config = getTableConfig(table);
  for (const column of config.columns) {
    if (column.primary) {
      primary.add(column.name);
    }
  }
  for (const key of config.primaryKeys) {
    for (const column of key.columns) {
      primary.add(column.name);
    }
  }
  const names: string[] = [];
  for (const [name, column] of Object.entries(getTableColumns(table))) {
    if (primary.has(column.name)) {
      names.push(name);
    }
  }
  return names;
}

function keyOf(table: StoryTable, row: Row): Row {
  const key: Row = {};
  for (const name of keyColumns(table)) {
    key[name] = row[name];
  }
  return key;
}

function columnsOf(table: StoryTable): Record<string, PgColumn> {
  return getTableColumns(table) as Record<string, PgColumn>;
}

function whereKey(table: StoryTable, key: Row): SQL {
  const columns = columnsOf(table);
  const conditions: SQL[] = [];
  for (const [name, value] of Object.entries(key)) {
    conditions.push(eq(columns[name], value));
  }
  return and(...conditions) as SQL;
}

/** Only the columns named in `set`, as the row had them. */
function picked(row: Row, set: Row): Row {
  const out: Row = {};
  for (const name of Object.keys(set)) {
    out[name] = row[name];
  }
  return out;
}

/**
 * A version as the table takes it again: only columns it still has, and times as dates (the log
 * keeps them as JSON, where they're text).
 */
function revived(table: StoryTable, kept: unknown): Row {
  const columns = columnsOf(table);
  const row: Row = {};
  for (const [name, value] of Object.entries(kept as Row)) {
    const column = columns[name];
    if (!column) {
      continue;
    }
    if (column.dataType === 'date' && typeof value === 'string') {
      row[name] = new Date(value);
    } else {
      row[name] = value;
    }
  }
  return row;
}

async function keep(tx: Tx, change: Change, table: StoryTable, key: Row, before: Row | null, after: Row | null) {
  await tx.insert(versions).values({ changeId: change.id, table: getTableName(table), key, before, after });
}

/** Starts a change. Every row it touches goes through make, edit or remove with it. */
export async function startChange(tx: Tx, tag: Tag): Promise<Change> {
  const [change] = await tx
    .insert(changes)
    .values({ bookId: tag.bookId, turnId: tag.turnId, by: tag.by, what: tag.what, why: tag.why ?? '' })
    .returning();
  return change;
}

/** Makes a row as part of the change. */
export async function make<T extends StoryTable>(tx: Tx, change: Change, table: T, row: T['$inferInsert']): Promise<T['$inferSelect']> {
  const [made] = (await tx
    .insert(table as StoryTable)
    .values(row as never)
    .returning()) as Row[];
  await keep(tx, change, table, keyOf(table, made), null, made);
  return made as T['$inferSelect'];
}

async function rowAt(tx: Tx, table: StoryTable, key: Row): Promise<Row | null> {
  const [row] = (await tx
    .select()
    .from(table as StoryTable)
    .where(whereKey(table, key))) as Row[];
  if (!row) {
    return null;
  }
  return row;
}

/** Edits a row as part of the change, keeping what the edited columns said before. */
export async function edit<T extends StoryTable>(
  tx: Tx,
  change: Change,
  table: T,
  key: Partial<T['$inferSelect']>,
  set: Partial<T['$inferInsert']>,
): Promise<T['$inferSelect']> {
  const before = await rowAt(tx, table, key);
  if (!before) {
    throw new StoryError(`There's no such row in ${getTableName(table)} to change.`);
  }
  const [after] = (await tx
    .update(table as StoryTable)
    .set(set as never)
    .where(whereKey(table, key))
    .returning()) as Row[];
  await keep(tx, change, table, key, picked(before, set), set);
  return after as T['$inferSelect'];
}

/** Removes a row as part of the change, keeping all of it. */
export async function remove<T extends StoryTable>(tx: Tx, change: Change, table: T, key: Partial<T['$inferSelect']>) {
  const before = await rowAt(tx, table, key);
  if (!before) {
    throw new StoryError(`There's no such row in ${getTableName(table)} to remove.`);
  }
  await tx.delete(table as StoryTable).where(whereKey(table, key));
  await keep(tx, change, table, key, before, null);
}

async function changeOf(tx: Tx, id: number): Promise<Change> {
  const [change] = await tx.select().from(changes).where(eq(changes.id, id));
  if (!change) {
    throw new StoryError(`There's no change ${id}.`);
  }
  return change;
}

/** Whether this change took another back. */
async function isTakeBack(tx: Tx, change: Change): Promise<boolean> {
  const [undone] = await tx.select({ id: changes.id }).from(changes).where(eq(changes.takenBackBy, change.id));
  return Boolean(undone);
}

/**
 * A later change, still standing, that touched the same row as this version, if there is one. A
 * change taken back and its take-back cancel out, so neither counts.
 */
async function laterChangeTo(tx: Tx, version: Version): Promise<number | null> {
  const undone = alias(changes, 'undone');
  const takesBackAnother = tx.select({ id: undone.id }).from(undone).where(eq(undone.takenBackBy, changes.id));
  const [later] = await tx
    .select({ changeId: versions.changeId })
    .from(versions)
    .innerJoin(changes, eq(changes.id, versions.changeId))
    .where(
      and(
        eq(versions.table, version.table),
        sql`${versions.key} = ${JSON.stringify(version.key)}::jsonb`,
        gt(versions.id, version.id),
        ne(versions.changeId, version.changeId),
        isNull(changes.takenBackBy),
        notExists(takesBackAnother),
      ),
    )
    .orderBy(asc(versions.id))
    .limit(1);
  if (!later) {
    return null;
  }
  return later.changeId;
}

/** Puts one row back the way it was before this version. */
async function putBack(tx: Tx, change: Change, version: Version) {
  const table = tableNamed(version.table);
  const key = version.key as Row;
  if (version.before === null) {
    await remove(tx, change, table, key);
    return;
  }
  const before = revived(table, version.before);
  if (version.after === null) {
    // The log kept this row whole from the table itself, and Postgres turns away anything that
    // no longer fits it.
    await make(tx, change, table, before as StoryTable['$inferInsert']);
    return;
  }
  await edit(tx, change, table, key, before);
}

/**
 * Takes a change back: a new change, tagged like any other, that puts every row it touched back
 * the way it was. A change that later ones built on has to wait until they're taken back first,
 * so nothing they did is quietly lost. Undo takes back the newest first, so it never waits.
 */
export async function takeBack(tx: Tx, id: number, tag: Omit<Tag, 'bookId' | 'what'>): Promise<Change> {
  const original = await changeOf(tx, id);
  if (original.takenBackBy !== null) {
    throw new StoryError(`Change ${id} was already taken back.`);
  }
  if (await isTakeBack(tx, original)) {
    throw new StoryError(`Change ${id} took another back, and a take-back can't be taken back.`);
  }
  const touched = await tx.select().from(versions).where(eq(versions.changeId, id)).orderBy(desc(versions.id));
  for (const version of touched) {
    const later = await laterChangeTo(tx, version);
    if (later !== null) {
      throw new StoryError(`Change ${later} changed the same thing later. Take it back first.`);
    }
  }

  const back = await startChange(tx, { ...tag, bookId: original.bookId, what: `Took back: ${original.what}` });
  for (const version of touched) {
    await putBack(tx, back, version);
  }
  await tx.update(changes).set({ takenBackBy: back.id }).where(eq(changes.id, id));
  return back;
}

/** The changes made at a turn that still stand, by whom, newest first: what undoing the turn takes back. */
export async function standingAt(db: Db | Tx, turnId: string, by: Who): Promise<Change[]> {
  return db
    .select()
    .from(changes)
    .where(and(eq(changes.turnId, turnId), eq(changes.by, by), isNull(changes.takenBackBy)))
    .orderBy(desc(changes.id));
}

/** Every version a change kept, in the order it made them, for looking a change over. */
export async function versionsOf(db: Db | Tx, changeId: number): Promise<Version[]> {
  return db.select().from(versions).where(eq(versions.changeId, changeId)).orderBy(asc(versions.id));
}
