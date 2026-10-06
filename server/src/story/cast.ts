import { asc, eq } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.ts';
import { characters } from '../db/schema.ts';
import { Cast } from './mentions.ts';

/*
 * A book's cast as the story reads it: their sheets in cast order, their names by id for showing
 * mentions, and the cast by name for turning links into mentions.
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
