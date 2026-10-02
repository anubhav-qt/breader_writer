import { and, asc, eq, notInArray } from 'drizzle-orm';
import { everyone, WORD_GOALS, type BookSetup, type Character, type Darkness, type Length, type Pov } from '@writer/shared/book';
import type { BookCard } from '@writer/shared/protocol';
import type { Db } from '../db/client.ts';
import { books, characters, feelings, worlds } from '../db/schema.ts';

/*
 * A book's setup in the database: the book's own row (title, colour, length, point of view,
 * darkness), its world, its characters and how they feel about each other.
 */

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type BookRow = typeof books.$inferSelect;
type CharacterRow = typeof characters.$inferSelect;
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

/**
 * Writes the book's world, cast and feelings as the setup has them. Characters keep their ids, so
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

  await tx.delete(feelings).where(eq(feelings.bookId, bookId));
  const lines = [];
  for (const character of everyone(setup)) {
    for (const [aboutId, text] of Object.entries(character.feelings)) {
      if (text) {
        lines.push({ bookId, characterId: character.id, aboutId, text });
      }
    }
  }
  if (lines.length > 0) {
    await tx.insert(feelings).values(lines);
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

function toCharacter(row: CharacterRow, feelingsOf: Map<string, Record<string, string>>): Character {
  let lines = feelingsOf.get(row.id);
  if (!lines) {
    lines = {};
  }
  return {
    id: row.id,
    name: row.name,
    who: row.who,
    personality: row.personality,
    past: row.past,
    feelings: lines,
    notes: row.notes,
  };
}

/** A book's setup as it's saved. */
export async function readSetup(db: Db, book: BookRow): Promise<BookSetup> {
  const [world] = await db.select().from(worlds).where(eq(worlds.bookId, book.id));
  const rows = await db.select().from(characters).where(eq(characters.bookId, book.id)).orderBy(asc(characters.position));
  const lines = await db.select().from(feelings).where(eq(feelings.bookId, book.id));

  const feelingsOf = new Map<string, Record<string, string>>();
  for (const line of lines) {
    let theirs = feelingsOf.get(line.characterId);
    if (!theirs) {
      theirs = {};
      feelingsOf.set(line.characterId, theirs);
    }
    theirs[line.aboutId] = line.text;
  }

  let protagonist: Character | null = null;
  const cast: Character[] = [];
  for (const row of rows) {
    const character = toCharacter(row, feelingsOf);
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
  };
}
