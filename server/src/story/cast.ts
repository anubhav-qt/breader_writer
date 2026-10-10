import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { CAST_LIMIT, LONG_LIMIT, NAME_LIMIT, NOTES_LIMIT } from '@writer/shared/book';
import type { Db, Tx } from '../db/client.ts';
import { characters } from '../db/schema.ts';
import { make, StoryError, type Change } from './changes.ts';
import { Cast } from './mentions.ts';

/*
 * A book's cast as the story reads it: their sheets in cast order, their names by id for showing
 * mentions, and the cast by name for turning links into mentions. The story can bring someone in
 * as it goes: they get a sheet like the owner's own people.
 *
 * Someone the owner sends out of the story from now on keeps their sheet, with the role left, so
 * everything already written still names them; they're no longer in the cast as it stands.
 */

export type CharacterRow = typeof characters.$inferSelect;

/** The role of someone who left the cast mid story. */
export const LEFT = 'left';

/** Everyone with a sheet, in order, the protagonist first, those who left included. */
export async function castOf(db: Db | Tx, bookId: string): Promise<CharacterRow[]> {
  return db.select().from(characters).where(eq(characters.bookId, bookId)).orderBy(asc(characters.position));
}

/** Whether someone is in the cast as it stands: they haven't left. */
export function isStanding(person: CharacterRow): boolean {
  return person.role !== LEFT;
}

/** The cast as it stands, without those who left. */
export function standingOf(cast: CharacterRow[]): CharacterRow[] {
  return cast.filter(isStanding);
}

/** Everyone's name, by id. */
export function namesOf(cast: CharacterRow[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const character of cast) {
    names.set(character.id, character.name);
  }
  return names;
}

/** The book's cast by name, for links: those who left included, since what was written names them. */
export async function castByName(db: Db | Tx, bookId: string): Promise<Cast> {
  const cast = await castOf(db, bookId);
  return new Cast(cast);
}

/** The cast as it stands, by name: who can be in a scene, or cued. */
export async function standingByName(db: Db | Tx, bookId: string): Promise<Cast> {
  const cast = await castOf(db, bookId);
  return new Cast(standingOf(cast));
}

/** A newcomer's sheet, as the story writes it. */
export interface Newcomer {
  name: string;
  who: string;
  personality: string;
  past: string;
}

function fitting(text: string, limit: number, what: string): string {
  const trimmed = text.trim();
  if (trimmed.length > limit) {
    throw new StoryError(`${what} holds ${limit} characters at most, and that's ${trimmed.length}.`);
  }
  return trimmed;
}

/**
 * A name as the cast keeps it: one line, without brackets (links are written [[Name]]), and no one
 * else's, those who left included, so a link always names one person. `self` is the one being
 * named, when it's a rename.
 */
export function castName(cast: CharacterRow[], name: string, self: string | null): string {
  const spaced = name.trim().replace(/\s+/g, ' ');
  if (!spaced) {
    throw new StoryError('Someone in the cast needs a name.');
  }
  if (/[[\]]/.test(spaced)) {
    throw new StoryError('Write the name without brackets.');
  }
  const others = cast.filter((person) => person.id !== self);
  if (new Cast(others).idsOf(spaced).length > 0) {
    throw new StoryError(`Someone in the cast is called ${spaced} already. Give them a name of their own, or a fuller one.`);
  }
  return fitting(spaced, NAME_LIMIT, 'A name');
}

/** A sheet as someone takes their seat in the cast: their id, and what the sheet says. */
export interface Seat extends Newcomer {
  id: string;
  notes: string;
}

/** Someone takes a seat in the cast, after everyone else. */
export async function seatInCast(tx: Tx, change: Change, seat: Seat): Promise<CharacterRow> {
  const cast = await castOf(tx, change.bookId);
  if (cast.some((person) => person.id === seat.id)) {
    throw new StoryError('Someone in the story has that id already.');
  }
  // The protagonist isn't counted, as setup doesn't count them.
  if (standingOf(cast).length - 1 >= CAST_LIMIT) {
    throw new StoryError(`The cast is full: it holds ${CAST_LIMIT} people besides the one the owner plays.`);
  }
  const name = castName(cast, seat.name, null);
  let position = 0;
  for (const person of cast) {
    position = Math.max(position, person.position + 1);
  }
  return make(tx, change, characters, {
    bookId: change.bookId,
    id: seat.id,
    role: 'cast',
    position,
    name,
    who: fitting(seat.who, LONG_LIMIT, 'Who they are'),
    personality: fitting(seat.personality, LONG_LIMIT, 'Their personality'),
    past: fitting(seat.past, LONG_LIMIT, 'Their past'),
    notes: fitting(seat.notes, NOTES_LIMIT, 'Their notes'),
  });
}

/** Someone new joins the cast, after everyone else, with a sheet of their own. */
export async function joinCast(tx: Tx, change: Change, newcomer: Newcomer): Promise<CharacterRow> {
  return seatInCast(tx, change, { ...newcomer, id: randomUUID(), notes: '' });
}
