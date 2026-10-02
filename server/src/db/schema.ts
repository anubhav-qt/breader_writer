import { sql } from 'drizzle-orm';
import { foreignKey, index, integer, pgSchema, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/*
 * The writer's tables. They live in breader's database, in their own Postgres schema, `writer`,
 * with their own migrations table (writer.migrations, see migrate.ts), so the writer's migrations
 * and breader's never touch each other. drizzle-kit only looks at this file and this schema.
 */

export const writer = pgSchema('writer');

const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** A book: one story played and written, and what it was set up with. */
export const books = writer.table(
  'books',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The breader account that owns it: its Better Auth user id (breader's users.id). */
    userId: text('user_id').notNull(),
    title: text('title').notNull(),
    /** A palette key from the app's book colours. */
    color: text('color').notNull(),
    /** Short story, novella, light novel or novel (shared/src/book.ts). */
    length: text('length').notNull(),
    /** The length goal in words, from the length. The card's bar is words written over this. */
    wordGoal: integer('word_goal').notNull(),
    /** Point of view: third_close, first or third_omniscient. */
    pov: text('pov').notNull(),
    /** How dark it goes: gentle, mature or unflinching. */
    darkness: text('darkness').notNull(),
    wordsWritten: integer('words_written').notNull().default(0),
    createdAt: at('created_at').notNull().defaultNow(),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [index('books_user_idx').on(t.userId, t.updatedAt)],
);

/** A book's world: a few fields plus notes, blank where the owner left them blank. */
export const worlds = writer.table('worlds', {
  bookId: uuid('book_id')
    .primaryKey()
    .references(() => books.id, { onDelete: 'cascade' }),
  genre: text('genre').notNull().default(''),
  tone: text('tone').notNull().default(''),
  setting: text('setting').notNull().default(''),
  rules: text('rules').notNull().default(''),
  notes: text('notes').notNull().default(''),
});

/**
 * A character's sheet. The app makes the id, so it's only unique within its book: the key is the
 * book and the id together, and no book can reach another's characters.
 */
export const characters = writer.table(
  'characters',
  {
    bookId: uuid('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    id: uuid('id').notNull(),
    /** protagonist (the one the owner plays) or cast. */
    role: text('role').notNull(),
    /** Where they come in the cast, from 0. */
    position: integer('position').notNull(),
    name: text('name').notNull(),
    who: text('who').notNull().default(''),
    personality: text('personality').notNull().default(''),
    past: text('past').notNull().default(''),
    notes: text('notes').notNull().default(''),
  },
  (t) => [
    primaryKey({ columns: [t.bookId, t.id] }),
    uniqueIndex('characters_one_protagonist').on(t.bookId).where(sql`role = 'protagonist'`),
  ],
);

/** How one character feels about another. Only lines with something in them are kept. */
export const feelings = writer.table(
  'feelings',
  {
    bookId: uuid('book_id').notNull(),
    characterId: uuid('character_id').notNull(),
    aboutId: uuid('about_id').notNull(),
    text: text('text').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.bookId, t.characterId, t.aboutId] }),
    foreignKey({ columns: [t.bookId, t.characterId], foreignColumns: [characters.bookId, characters.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.bookId, t.aboutId], foreignColumns: [characters.bookId, characters.id] }).onDelete('cascade'),
  ],
);
