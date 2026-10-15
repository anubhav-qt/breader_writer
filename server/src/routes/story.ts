import { Hono } from 'hono';
import type { SSEStreamingApi } from 'hono/streaming';
import { z } from 'zod';
import { EditAsk, type EditEvent, type StoryEdit, type Reach } from '@writer/shared/story';
import { ModelError } from '../ai/call.ts';
import { findBook, type BookRow } from '../books/setup.ts';
import { rewriteView, storyView } from '../books/story.ts';
import type { AppEnv, Deps } from '../context.ts';
import { requireWriter } from '../lib/access.ts';
import { ApiError, parse, readJson } from '../lib/errors.ts';
import { eventStream } from '../lib/sse.ts';
import { log } from '../log.ts';
import { changeStory, reachesBack } from '../play/edits.ts';
import { alone, PlayError } from '../play/play.ts';
import type { Procreator } from '../procreator/run.ts';
import { StoryError } from '../story/changes.ts';
import { failedFrom, modelFor } from './ai.ts';

/*
 * The story mid play, for the Story panel (step 6): what it holds, the owner's changes to it,
 * which go through breading_ground like every other change to the story, and what a change that
 * reached back rewrote.
 */

const notFound = () => new ApiError(404, 'not_found', 'There’s no such book here.');

/** Sends one of an edit's events down the stream. */
async function send(stream: SSEStreamingApi, event: EditEvent) {
  await stream.writeSSE({ data: JSON.stringify(event) });
}

/** What a change couldn't do, as the owner is told it, or null for the server's own failure. */
function problemOf(err: unknown): ApiError | null {
  if (err instanceof StoryError || err instanceof PlayError) {
    return new ApiError(409, 'story_conflict', err.message);
  }
  if (err instanceof ModelError) {
    log.warn({ err: err.message }, 'Procreator didn’t answer a rewrite');
    return failedFrom(err);
  }
  return null;
}

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

  /** The story as it stands, with the title as it may have changed. */
  async function storyNow(userId: string, book: BookRow) {
    const changed = await findBook(deps.db, userId, book.id);
    return storyView(deps.db, changed ?? book);
  }

  /** Procreator on the account's model when the change reaches back (a 503 while the AI is offline), else null. */
  async function rewriterFor(userId: string, book: BookRow, edit: StoryEdit, reach: Reach, signal: AbortSignal): Promise<Procreator | null> {
    if (!(await reachesBack(deps.db, book.id, edit, reach))) {
      return null;
    }
    const { catalog, inUse } = await modelFor(deps, userId);
    return { db: deps.db, catalog, inUse, userId, signal };
  }

  /** The story as the Story panel shows it. */
  r.get('/books/:id/story', async (c) => {
    const book = await ownBook(c.var.login.id, c.req.param('id'));
    return c.json(await storyView(deps.db, book));
  });

  /**
   * The owner changes the story, from now on or always so. Streams how far a rewrite of the past
   * has got, then the story as it stands with what was rewritten, or why it couldn't be made.
   */
  r.post('/books/:id/story/edits', async (c) => {
    const ask = parse(EditAsk, await readJson(c));
    const userId = c.var.login.id;
    const book = await ownBook(userId, c.req.param('id'));
    const ai = await rewriterFor(userId, book, ask.edit, ask.reach, c.req.raw.signal);
    return eventStream(c, async (stream) => {
      const onProgress = (done: number, of: number) => {
        void send(stream, { type: 'rewriting', done, of });
      };
      try {
        const rewrote = await alone(book.id, () => changeStory(deps.db, ai, book.id, ask.edit, ask.reach, onProgress));
        await send(stream, { type: 'done', story: await storyNow(userId, book), rewrote });
      } catch (err) {
        const problem = problemOf(err);
        let code = 'server_error';
        let message = 'Something went wrong on the server. Try again in a moment.';
        if (problem) {
          code = problem.code;
          message = problem.message;
        } else {
          log.error({ err, bookId: book.id }, 'an edit to the story failed');
        }
        await send(stream, { type: 'error', code, message, story: await storyNow(userId, book) });
      }
    });
  });

  /** What a change that reached back rewrote, each passage before and after. */
  r.get('/books/:id/story/rewrites/:change', async (c) => {
    const book = await ownBook(c.var.login.id, c.req.param('id'));
    const change = z.coerce.number().int().positive().safeParse(c.req.param('change'));
    if (!change.success) {
      throw notFound();
    }
    const view = await rewriteView(deps.db, book.id, change.data);
    if (!view) {
      throw new ApiError(404, 'not_found', 'There’s no such rewrite here.');
    }
    return c.json(view);
  });

  return r;
}
