import { and, asc, eq, notInArray } from 'drizzle-orm';
import {
  everyone,
  inOrder,
  WORD_GOALS,
  type BookSetup,
  type Character,
  type Darkness,
  type Length,
  type Pov,
  type Relationship,
} from '@writer/shared/book';
import type { BookCard } from '@writer/shared/protocol';
import type { Db } from '../db/client.ts';
import { books, characters, relationships, worlds } from '../db/schema.ts';

/*
 * A book's setup in the database: the book's own row (title, colour, length, point of view,
 * darkness), its world, its characters and the relationships between them.
 */

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type BookRow = typeof books.$inferSelect;
type CharacterRow = typeof characters.$inferSelect;
type RelationshipRow = typeof relationships.$inferSelect;
type Role = 'protagonist' | 'cast';

export function toCard(row: BookRow): BookCard {
  return {
    id: row.id,
    title: row.title,
    color: row.color,
    length: row.length as Length,
    wordsWritten: row.wordsWritten,
    wordGoal: row.wordGoal,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

/** The book's own settings, as its row has them. */
function settings(setup: BookSetup) {
  return {
    title: setup.title,
    color: setup.color,
    length: setup.length,
    wordGoal: WORD_GOALS[setup.length],
    pov: setup.pov,
    darkness: setup.darkness,
  };
}

function characterRow(bookId: string, character: Character, role: Role, position: number): CharacterRow {
  return {
    bookId,
    id: character.id,
    role,
    position,
    name: character.name,
    who: character.who,
    personality: character.personality,
    past: character.past,
    notes: character.notes,
  };
}

async function saveCharacter(tx: Tx, row: CharacterRow) {
  await tx
    .insert(characters)
    .values(row)
    .onConflictDoUpdate({
      target: [characters.bookId, characters.id],
      set: {
        role: row.role,
        position: row.position,
        name: row.name,
        who: row.who,
        personality: row.personality,
        past: row.past,
        notes: row.notes,
      },
    });
}

function relationshipRow(bookId: string, relationship: Relationship): RelationshipRow {
  const stored = inOrder(relationship);
  return {
    bookId,
    aId: stored.a.id,
    bId: stored.b.id,
    bond: stored.bond,
    aSees: stored.a.sees,
    aHides: stored.a.hides,
    bSees: stored.b.sees,
    bHides: stored.b.hides,
  };
}

/**
 * Writes the book's world, cast and relationships as the setup has them. Characters keep their ids, so
 * a character who stays is updated rather than made again, and only those no longer in the setup
 * are removed.
 */
async function saveSheets(tx: Tx, bookId: string, setup: BookSetup) {
  await tx
    .insert(worlds)
    .values({ bookId, ...setup.world })
    .onConflictDoUpdate({ target: worlds.bookId, set: setup.world });

  const ids = everyone(setup).map((character) => character.id);
  await tx.delete(characters).where(and(eq(characters.bookId, bookId), notInArray(characters.id, ids)));

  // The cast before the protagonist: a book has one protagonist at a time, so if the old one is
  // now in the cast, they step down before the new one steps up.
  let position = 1;
  for (const character of setup.cast) {
    await saveCharacter(tx, characterRow(bookId, character, 'cast', position));
    position += 1;
  }
  await saveCharacter(tx, characterRow(bookId, setup.protagonist, 'protagonist', 0));

  await tx.delete(relationships).where(eq(relationships.bookId, bookId));
  const rows = setup.relationships.map((relationship) => relationshipRow(bookId, relationship));
  if (rows.length > 0) {
    await tx.insert(relationships).values(rows);
  }
}

/** Makes a book for the account from its setup. */
export async function createBook(db: Db, userId: string, setup: BookSetup): Promise<BookCard> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(books)
      .values({ userId, ...settings(setup) })
      .returning();
    await saveSheets(tx, row.id, setup);
    return toCard(row);
  });
}

/** The account's book with this id, or null if it has none. */
export async function findBook(db: Db, userId: string, id: string): Promise<BookRow | null> {
  const [row] = await db
    .select()
    .from(books)
    .where(and(eq(books.id, id), eq(books.userId, userId)));
  if (!row) {
    return null;
  }
  return row;
}

/** Changes a book's setup. The book must be the account's (findBook). */
export async function updateSetup(db: Db, bookId: string, setup: BookSetup): Promise<BookCard> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(books)
      .set({ ...settings(setup), updatedAt: new Date() })
      .where(eq(books.id, bookId))
      .returning();
    await saveSheets(tx, bookId, setup);
    return toCard(row);
  });
}

function toCharacter(row: CharacterRow): Character {
  return {
    id: row.id,
    name: row.name,
    who: row.who,
    personality: row.personality,
    past: row.past,
    notes: row.notes,
  };
}

function toRelationship(row: RelationshipRow): Relationship {
  return {
    bond: row.bond,
    a: { id: row.aId, sees: row.aSees, hides: row.aHides },
    b: { id: row.bId, sees: row.bSees, hides: row.bHides },
  };
}

/** A book's setup as it's saved. */
export async function readSetup(db: Db, book: BookRow): Promise<BookSetup> {
  const [world] = await db.select().from(worlds).where(eq(worlds.bookId, book.id));
  const rows = await db.select().from(characters).where(eq(characters.bookId, book.id)).orderBy(asc(characters.position));
  const lines = await db
    .select()
    .from(relationships)
    .where(eq(relationships.bookId, book.id))
    .orderBy(asc(relationships.aId), asc(relationships.bId));

  let protagonist: Character | null = null;
  const cast: Character[] = [];
  for (const row of rows) {
    const character = toCharacter(row);
    if (row.role === 'protagonist') {
      protagonist = character;
    } else {
      cast.push(character);
    }
  }
  if (!protagonist) {
    throw new Error(`Book ${book.id} has no protagonist.`);
  }

  return {
    title: book.title,
    color: book.color,
    length: book.length as Length,
    pov: book.pov as Pov,
    darkness: book.darkness as Darkness,
    world: {
      genre: world.genre,
      tone: world.tone,
      setting: world.setting,
      rules: world.rules,
      notes: world.notes,
    },
    protagonist,
    cast,
    relationships: lines.map(toRelationship),
  };
}
