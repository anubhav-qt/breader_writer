import { Hono } from 'hono';
import { z } from 'zod';
import { EditAsk } from '@writer/shared/story';
import { ownerEdit } from '../breading_ground.ts';
import { findBook, type BookRow } from '../books/setup.ts';
import { storyView } from '../books/story.ts';
import type { AppEnv, Deps } from '../context.ts';
import { requireWriter } from '../lib/access.ts';
import { ApiError, parse, readJson } from '../lib/errors.ts';
import { alone, PlayError } from '../play/play.ts';
import { StoryError } from '../story/changes.ts';

/*
 * The story mid play, for the Story panel (step 6): what it holds, and the owner's changes to it,
 * which go through breading_ground like every other change to the story.
 */

const notFound = () => new ApiError(404, 'not_found', 'There’s no such book here.');

export function storyRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();
  r.use('/books/:id/story', requireWriter(deps));
  r.use('/books/:id/story/*', requireWriter(deps));

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

  /** The story as the Story panel shows it. */
  r.get('/books/:id/story', async (c) => {
    const book = await ownBook(c.var.login.id, c.req.param('id'));
    return c.json(await storyView(deps.db, book));
  });

  /** The owner changes the story, from now on or always so. Answers with the story as it stands. */
  r.post('/books/:id/story/edits', async (c) => {
    const ask = parse(EditAsk, await readJson(c));
    const book = await ownBook(c.var.login.id, c.req.param('id'));
    try {
      await alone(book.id, () => ownerEdit(deps.db, book.id, ask.edit, ask.reach));
    } catch (err) {
      if (err instanceof StoryError || err instanceof PlayError) {
        throw new ApiError(409, 'story_conflict', err.message);
      }
      throw err;
    }
    // The title may have changed with it.
    const changed = await findBook(deps.db, c.var.login.id, book.id);
    return c.json(await storyView(deps.db, changed ?? book));
  });

  return r;
}
