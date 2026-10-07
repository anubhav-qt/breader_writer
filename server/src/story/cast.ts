import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { CAST_LIMIT, LONG_LIMIT, NAME_LIMIT } from '@writer/shared/book';
import type { Db, Tx } from '../db/client.ts';
import { characters } from '../db/schema.ts';
import { make, StoryError, type Change } from './changes.ts';
import { Cast } from './mentions.ts';

/*
 * A book's cast as the story reads it: their sheets in cast order, their names by id for showing
 * mentions, and the cast by name for turning links into mentions. The story can bring someone in
 * as it goes: they get a sheet like the owner's own people.
 */

export type CharacterRow = typeof characters.$inferSelect;

/** The book's cast in order, the protagonist first. */
export async function castOf(db: Db | Tx, bookId: string): Promise<CharacterRow[]> {
  return db.select().from(characters).where(eq(characters.bookId, bookId)).orderBy(asc(characters.position));
}

/** Everyone's name, by id. */
export function namesOf(cast: CharacterRow[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const character of cast) {
    names.set(character.id, character.name);
  }
  return names;
}

/** The book's cast by name, for links. */
export async function castByName(db: Db | Tx, bookId: string): Promise<Cast> {
  const cast = await castOf(db, bookId);
  return new Cast(cast);
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

/** Someone new joins the cast, after everyone else, with a sheet of their own. */
export async function joinCast(tx: Tx, change: Change, newcomer: Newcomer): Promise<CharacterRow> {
  const name = newcomer.name.trim().replace(/\s+/g, ' ');
  if (!name) {
    throw new StoryError('Someone joining the cast needs a name.');
  }
  if (/[[\]]/.test(name)) {
    throw new StoryError('Write the name without brackets.');
  }
  const cast = await castOf(tx, change.bookId);
  // The protagonist isn't counted, as setup doesn't count them.
  if (cast.length - 1 >= CAST_LIMIT) {
    throw new StoryError(`The cast is full: it holds ${CAST_LIMIT} people besides the one the owner plays.`);
  }
  if (new Cast(cast).idsOf(name).length > 0) {
    throw new StoryError(`Someone in the cast is called ${name} already. Give them a name of their own, or a fuller one.`);
  }
  let position = 0;
  for (const person of cast) {
    position = Math.max(position, person.position + 1);
  }
  return make(tx, change, characters, {
    bookId: change.bookId,
    id: randomUUID(),
    role: 'cast',
    position,
    name: fitting(name, NAME_LIMIT, 'A name'),
    who: fitting(newcomer.who, LONG_LIMIT, 'Who they are'),
    personality: fitting(newcomer.personality, LONG_LIMIT, 'Their personality'),
    past: fitting(newcomer.past, LONG_LIMIT, 'Their past'),
    notes: '',
  });
}
