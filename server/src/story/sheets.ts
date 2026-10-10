import { and, eq, or } from 'drizzle-orm';
import { inOrder, LONG_LIMIT, NOTES_LIMIT, SHORT_LIMIT, WORD_GOALS, type Character, type Relationship, type World } from '@writer/shared/book';
import type { BookChoices } from '@writer/shared/story';
import type { Tx } from '../db/client.ts';
import { books, characters, pages, relationshipHistory, relationships, scenes, worlds } from '../db/schema.ts';
import { castName, castOf, isStanding, LEFT, seatInCast, type CharacterRow } from './cast.ts';
import { edit, make, remove, StoryError, type Change } from './changes.ts';

/*
 * The owner's own pieces of the story, changed mid story from the Story panel (step 6): someone's
 * sheet, someone new, someone leaving or taken out, a line tied, changed or untied, the world and
 * the book's choices. Each is part of a change (story/changes.ts), so it's tagged as the owner's
 * and every row it touches keeps its version. Only breading_ground calls these.
 */

type CharacterSet = Partial<typeof characters.$inferInsert>;
type RelationshipRow = typeof relationships.$inferSelect;
type RelationshipSet = Partial<typeof relationships.$inferInsert>;

function fitting(text: string, limit: number, what: string): string {
  const trimmed = text.trim();
  if (trimmed.length > limit) {
    throw new StoryError(`${what} holds ${limit} characters at most, and that's ${trimmed.length}.`);
  }
  return trimmed;
}

/** Someone in the cast as it stands, by id. */
async function standingPerson(tx: Tx, bookId: string, id: string): Promise<CharacterRow> {
  const cast = await castOf(tx, bookId);
  const person = cast.find((each) => each.id === id);
  if (!person || !isStanding(person)) {
    throw new StoryError('That person isn’t in the cast.');
  }
  return person;
}

/** Someone's sheet as the owner changed it. Answers with the sheet as it stood before, or null when nothing changed. */
export async function changeSheet(tx: Tx, change: Change, character: Character): Promise<CharacterRow | null> {
  const before = await standingPerson(tx, change.bookId, character.id);
  const cast = await castOf(tx, change.bookId);
  const next = {
    name: castName(cast, character.name, character.id),
    who: fitting(character.who, LONG_LIMIT, 'Who they are'),
    personality: fitting(character.personality, LONG_LIMIT, 'Their personality'),
    past: fitting(character.past, LONG_LIMIT, 'Their past'),
    notes: fitting(character.notes, NOTES_LIMIT, 'Their notes'),
  };
  const set: CharacterSet = {};
  for (const [column, value] of Object.entries(next)) {
    if (before[column as keyof typeof next] !== value) {
      set[column as keyof typeof next] = value;
    }
  }
  if (Object.keys(set).length === 0) {
    return null;
  }
  await edit(tx, change, characters, { bookId: change.bookId, id: character.id }, set);
  return before;
}

/** Someone new in the cast, with the sheet the owner wrote. */
export async function addPerson(tx: Tx, change: Change, character: Character): Promise<CharacterRow> {
  return seatInCast(tx, change, character);
}

/** Takes someone out of the scene they're in, if they're in the one being played or the one waiting. */
async function outOfScenes(tx: Tx, change: Change, id: string) {
  const open = await tx
    .select()
    .from(scenes)
    .where(and(eq(scenes.bookId, change.bookId), or(eq(scenes.status, 'playing'), eq(scenes.status, 'next'))));
  for (const scene of open) {
    if (scene.present.includes(id)) {
      const present = scene.present.filter((each) => each !== id);
      await edit(tx, change, scenes, { id: scene.id }, { present });
    }
  }
}

function notTheProtagonist(person: CharacterRow) {
  if (person.role === 'protagonist') {
    throw new StoryError(`${person.name} is the one the owner plays, and stays in the story.`);
  }
}

/**
 * Someone leaves the cast from now on: their sheet stays, so everything written still names them,
 * and they're out of the scene they were in. Their lines stay, with their history.
 */
export async function leaveCast(tx: Tx, change: Change, id: string): Promise<CharacterRow> {
  const person = await standingPerson(tx, change.bookId, id);
  notTheProtagonist(person);
  await outOfScenes(tx, change, id);
  await edit(tx, change, characters, { bookId: change.bookId, id }, { role: LEFT });
  return person;
}

/** The lines someone is on, with each line's history, and their page: everything kept about them but their sheet. */
async function removeWhatsKeptAbout(tx: Tx, change: Change, id: string) {
  const lines = await tx
    .select()
    .from(relationships)
    .where(and(eq(relationships.bookId, change.bookId), or(eq(relationships.aId, id), eq(relationships.bId, id))));
  for (const line of lines) {
    await removeLine(tx, change, line, true);
  }
  const theirs = await tx.select().from(pages).where(and(eq(pages.bookId, change.bookId), eq(pages.characterId, id)));
  for (const page of theirs) {
    await remove(tx, change, pages, { id: page.id });
  }
}

/**
 * Someone taken out of the story altogether: their sheet, their page, their lines and their
 * history. For before anything is played, or once always so has written them out of the past.
 */
export async function removePerson(tx: Tx, change: Change, id: string): Promise<CharacterRow> {
  const cast = await castOf(tx, change.bookId);
  const person = cast.find((each) => each.id === id);
  if (!person) {
    throw new StoryError('That person isn’t in the story.');
  }
  notTheProtagonist(person);
  await outOfScenes(tx, change, id);
  await removeWhatsKeptAbout(tx, change, id);
  await remove(tx, change, characters, { bookId: change.bookId, id });
  return person;
}

async function lineBetween(tx: Tx, bookId: string, aId: string, bId: string): Promise<RelationshipRow | null> {
  const [line] = await tx
    .select()
    .from(relationships)
    .where(and(eq(relationships.bookId, bookId), eq(relationships.aId, aId), eq(relationships.bId, bId)));
  if (!line) {
    return null;
  }
  return line;
}

/** A line as the owner tied or changed it. Answers with the line as it stood before (null when it's new), and whether anything changed. */
export async function changeLine(tx: Tx, change: Change, relationship: Relationship): Promise<{ before: RelationshipRow | null; changed: boolean }> {
  const stored = inOrder(relationship);
  if (stored.a.id === stored.b.id) {
    throw new StoryError('A relationship is between two different people.');
  }
  await standingPerson(tx, change.bookId, stored.a.id);
  await standingPerson(tx, change.bookId, stored.b.id);
  const key = { bookId: change.bookId, aId: stored.a.id, bId: stored.b.id };
  const next = {
    bond: fitting(stored.bond, SHORT_LIMIT, 'A bond'),
    aSees: fitting(stored.a.sees, LONG_LIMIT, 'How they see the other'),
    aHides: fitting(stored.a.hides, LONG_LIMIT, 'What they hide'),
    bSees: fitting(stored.b.sees, LONG_LIMIT, 'How they see the other'),
    bHides: fitting(stored.b.hides, LONG_LIMIT, 'What they hide'),
  };
  const before = await lineBetween(tx, change.bookId, key.aId, key.bId);
  if (!before) {
    await make(tx, change, relationships, { ...key, ...next });
    return { before: null, changed: true };
  }
  const set: RelationshipSet = {};
  for (const [column, value] of Object.entries(next)) {
    if (before[column as keyof typeof next] !== value) {
      set[column as keyof typeof next] = value;
    }
  }
  if (Object.keys(set).length === 0) {
    return { before, changed: false };
  }
  await edit(tx, change, relationships, key, set);
  return { before, changed: true };
}

/** A line removed, and with `withHistory`, how the two got there too. */
async function removeLine(tx: Tx, change: Change, line: RelationshipRow, withHistory: boolean) {
  if (withHistory) {
    const history = await tx
      .select()
      .from(relationshipHistory)
      .where(and(eq(relationshipHistory.bookId, line.bookId), eq(relationshipHistory.aId, line.aId), eq(relationshipHistory.bId, line.bId)));
    for (const entry of history) {
      await remove(tx, change, relationshipHistory, { id: entry.id });
    }
  }
  await remove(tx, change, relationships, { bookId: line.bookId, aId: line.aId, bId: line.bId });
}

/**
 * Two people untied. From now on their history stays, as what happened between them; with
 * `withHistory` (before anything is played, or always so) it goes too.
 */
export async function untie(tx: Tx, change: Change, one: string, other: string, withHistory: boolean): Promise<RelationshipRow> {
  let aId = one;
  let bId = other;
  if (other < one) {
    aId = other;
    bId = one;
  }
  const line = await lineBetween(tx, change.bookId, aId, bId);
  if (!line) {
    throw new StoryError('Those two aren’t tied.');
  }
  await removeLine(tx, change, line, withHistory);
  return line;
}

type WorldRow = typeof worlds.$inferSelect;
type BookRow = typeof books.$inferSelect;

/** The world as the owner changed it. Answers with the world as it stood before, or null when nothing changed. */
export async function changeWorld(tx: Tx, change: Change, world: World): Promise<WorldRow | null> {
  const next = {
    genre: fitting(world.genre, SHORT_LIMIT, 'The genre'),
    tone: fitting(world.tone, SHORT_LIMIT, 'The tone'),
    setting: fitting(world.setting, LONG_LIMIT, 'The setting'),
    rules: fitting(world.rules, LONG_LIMIT, 'The rules'),
    notes: fitting(world.notes, NOTES_LIMIT, 'The notes'),
  };
  const [before] = await tx.select().from(worlds).where(eq(worlds.bookId, change.bookId));
  if (!before) {
    await make(tx, change, worlds, { bookId: change.bookId, ...next });
    return { bookId: change.bookId, genre: '', tone: '', setting: '', rules: '', notes: '' };
  }
  const set: Partial<WorldRow> = {};
  for (const [column, value] of Object.entries(next)) {
    if (before[column as keyof typeof next] !== value) {
      set[column as keyof typeof next] = value;
    }
  }
  if (Object.keys(set).length === 0) {
    return null;
  }
  await edit(tx, change, worlds, { bookId: change.bookId }, set);
  return before;
}

/** The book's own choices as the owner changed them. Answers with the book as it stood before, or null when nothing changed. */
export async function changeBook(tx: Tx, change: Change, choices: Omit<BookChoices, 'world'>): Promise<BookRow | null> {
  const [before] = await tx.select().from(books).where(eq(books.id, change.bookId));
  if (!before) {
    throw new StoryError('There’s no such book.');
  }
  const next = {
    title: choices.title.trim(),
    length: choices.length,
    wordGoal: WORD_GOALS[choices.length],
    pov: choices.pov,
    darkness: choices.darkness,
  };
  const set: Partial<BookRow> = {};
  for (const [column, value] of Object.entries(next)) {
    if (before[column as keyof typeof next] !== value) {
      set[column as keyof typeof next] = value as never;
    }
  }
  if (Object.keys(set).length === 0) {
    return null;
  }
  await edit(tx, change, books, { id: change.bookId }, set);
  return before;
}
