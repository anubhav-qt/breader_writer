import { index, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/*
 * The writer's tables. They live in breader's database, in their own Postgres schema, `writer`,
 * with their own migrations table (writer.migrations, see migrate.ts), so the writer's migrations
 * and breader's never touch each other. drizzle-kit only looks at this file and this schema.
 */

export const writer = pgSchema('writer');

const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** A book: one story played and written. Step 2 (setup) adds its world, cast and settings. */
export const books = writer.table(
  'books',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The breader account that owns it: its Better Auth user id (breader's users.id). */
    userId: text('user_id').notNull(),
    title: text('title').notNull(),
    /** A palette key from the app's book colours. */
    color: text('color').notNull(),
    /** The length goal in words. The card's bar is words written over this. */
    wordGoal: integer('word_goal').notNull(),
    wordsWritten: integer('words_written').notNull().default(0),
    createdAt: at('created_at').notNull().defaultNow(),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [index('books_user_idx').on(t.userId, t.updatedAt)],
);
