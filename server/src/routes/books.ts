import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { BookCard, BookList } from '@writer/shared/protocol';
import type { AppEnv, Deps } from '../context.ts';
import { books } from '../db/schema.ts';
import { requireWriter } from '../lib/access.ts';

type BookRow = typeof books.$inferSelect;

function toCard(row: BookRow): BookCard {
  return {
    id: row.id,
    title: row.title,
    color: row.color,
    wordsWritten: row.wordsWritten,
    wordGoal: row.wordGoal,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

export function bookRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();
  r.use('/books', requireWriter(deps));
  r.use('/books/*', requireWriter(deps));

  /** The account's books, most recently played first. */
  r.get('/books', async (c) => {
    const rows = await deps.db
      .select()
      .from(books)
      .where(eq(books.userId, c.var.login.id))
      .orderBy(desc(books.updatedAt));
    const list: BookList = { books: rows.map(toCard) };
    return c.json(list);
  });

  return r;
}
