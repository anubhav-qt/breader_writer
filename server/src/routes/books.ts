import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { BookSetup } from '@writer/shared/book';
import type { BookList } from '@writer/shared/protocol';
import { createBook, findBook, readSetup, toCard, updateSetup } from '../books/setup.ts';
import type { AppEnv, Deps } from '../context.ts';
import { books } from '../db/schema.ts';
import { requireWriter } from '../lib/access.ts';
import { ApiError, parse, readJson } from '../lib/errors.ts';

const notFound = () => new ApiError(404, 'not_found', 'There’s no such book here.');

export function bookRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();
  r.use('/books', requireWriter(deps));
  r.use('/books/*', requireWriter(deps));

  /** The account's book with the id in the path, or a 404 for anyone else's or none. */
  async function ownBook(userId: string, raw: string) {
    const id = z.uuid().safeParse(raw);
    if (!id.success) {
      throw notFound();
    }
    const book = await findBook(deps.db, userId, id.data);
    if (!book) {
      throw notFound();
    }
    return book;
  }

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

  /** Makes a book from its setup. Answers with its card. */
  r.post('/books', async (c) => {
    const setup = parse(BookSetup, await readJson(c));
    const card = await createBook(deps.db, c.var.login.id, setup);
    return c.json(card, 201);
  });

  /** What a book was set up with, for the setup page. */
  r.get('/books/:id/setup', async (c) => {
    const book = await ownBook(c.var.login.id, c.req.param('id'));
    const setup: BookSetup = await readSetup(deps.db, book);
    return c.json(setup);
  });

  /** Changes what a book is set up with. Answers with its card. */
  r.put('/books/:id/setup', async (c) => {
    const book = await ownBook(c.var.login.id, c.req.param('id'));
    const setup = parse(BookSetup, await readJson(c));
    const card = await updateSetup(deps.db, book.id, setup);
    return c.json(card);
  });

  return r;
}
