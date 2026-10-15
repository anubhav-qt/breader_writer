import { Hono } from 'hono';
import { z } from 'zod';
import { epubOf, fileNameOf } from '../book/epub.ts';
import { bookView } from '../book/view.ts';
import { findBook, type BookRow } from '../books/setup.ts';
import type { AppEnv, Deps } from '../context.ts';
import { requireWriter } from '../lib/access.ts';
import { ApiError } from '../lib/errors.ts';
import { writeTheBook } from './ai.ts';

/*
 * The book as it's written (step 7): its chapters for the book view, and the EPUB download. Opening
 * the book nudges the scribe, so a chapter that failed is tried again.
 */

const notFound = () => new ApiError(404, 'not_found', 'There’s no such book here.');

export function readingRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();
  r.use('/books/:id/book', requireWriter(deps));
  r.use('/books/:id/epub', requireWriter(deps));

  /** The account's book with the id in the path, or a 404 for anyone else's or none. */
  async function ownBook(userId: string, raw: string): Promise<BookRow> {
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

  /** The book as it's written so far. */
  r.get('/books/:id/book', async (c) => {
    const login = c.var.login;
    const book = await ownBook(login.id, c.req.param('id'));
    await writeTheBook(deps, login.id, book.id);
    return c.json(await bookView(deps.db, book, login.name, deps.scribe));
  });

  /** The book as an EPUB file, its chapters as written so far. */
  r.get('/books/:id/epub', async (c) => {
    const login = c.var.login;
    const book = await ownBook(login.id, c.req.param('id'));
    const view = await bookView(deps.db, book, login.name, deps.scribe);
    const file = epubOf({ id: book.id, title: view.title, author: view.author, chapters: view.chapters, modified: book.updatedAt });
    const name = fileNameOf(view.title);
    return c.body(file, 200, {
      'content-type': 'application/epub+zip',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    });
  });

  return r;
}
