import { Hono } from 'hono';
import { streamSSE, type SSEStreamingApi } from 'hono/streaming';
import { z } from 'zod';
import { Going, MoveAsk, OpenAsk, type Hints, type PlayEvent, type Undone, type Voice } from '@writer/shared/play';
import { ModelError } from '../ai/call.ts';
import { findBook } from '../books/setup.ts';
import type { AppEnv, Deps } from '../context.ts';
import { requireWriter } from '../lib/access.ts';
import { ApiError, parse, readJson } from '../lib/errors.ts';
import { log } from '../log.ts';
import {
  alone,
  another,
  askOpenings,
  finishStory,
  goOn,
  hintsFor,
  letActorPlay,
  makeMove,
  openStory,
  PlayError,
  undo,
  type Watch,
} from '../play/play.ts';
import { headOf, playView } from '../play/view.ts';
import { FoldError } from '../procreator/folds.ts';
import type { Procreator } from '../procreator/run.ts';
import { StoryError } from '../story/changes.ts';
import { failed, modelFor, writeTheBook } from './ai.ts';

const notFound = () => new ApiError(404, 'not_found', 'There’s no such book here.');

/** Sends one of play's events down the stream. */
async function send(stream: SSEStreamingApi, event: PlayEvent) {
  await stream.writeSSE({ data: JSON.stringify(event) });
}

/** What play couldn't do, as the owner is told it, or null for the server's own failure. */
function problemOf(err: unknown): ApiError | null {
  if (err instanceof PlayError || err instanceof StoryError) {
    return new ApiError(409, 'play_conflict', err.message);
  }
  if (err instanceof ModelError || err instanceof FoldError) {
    log.warn({ err: err.message }, 'Procreator didn’t answer in play');
    return failed();
  }
  return null;
}

/** Throws what play couldn't do as the owner is told it. */
function rethrown(err: unknown): never {
  const problem = problemOf(err);
  if (problem) {
    throw problem;
  }
  throw err;
}

export function playRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();
  r.use('/books/:id/play', requireWriter(deps));
  r.use('/books/:id/play/*', requireWriter(deps));

  /** The account's book with the id in the path, or a 404 for anyone else's or none. */
  async function ownBookId(userId: string, raw: string): Promise<string> {
    const id = z.uuid().safeParse(raw);
    if (!id.success) {
      throw notFound();
    }
    const book = await findBook(deps.db, userId, id.data);
    if (!book) {
      throw notFound();
    }
    return book.id;
  }

  /** Procreator on the account's model, or a 503 while the AI is offline. */
  async function procreatorFor(userId: string, signal: AbortSignal): Promise<Procreator> {
    const { catalog, inUse } = await modelFor(deps, userId);
    return { db: deps.db, catalog, inUse, userId, signal };
  }

  /**
   * Streams a move's work: the scene's heading when it's set, Procreator's words as it writes them,
   * then the play as it stands, or why it couldn't go on.
   */
  function streamed(userId: string, bookId: string, stream: SSEStreamingApi, work: (watch: Watch) => Promise<void>) {
    const watch: Watch = {
      onText: (delta) => {
        void send(stream, { type: 'text', delta });
      },
      onScene: (scene) => {
        void send(stream, { type: 'scene', scene: headOf(scene) });
      },
      onFinishing: (scene) => {
        void send(stream, { type: 'finishing', scene });
      },
    };
    return (async () => {
      try {
        await alone(bookId, () => work(watch));
        await writeTheBook(deps, userId, bookId);
        await send(stream, { type: 'done', play: await playView(deps.db, bookId) });
      } catch (err) {
        const problem = problemOf(err);
        let code = 'server_error';
        let message = 'Something went wrong on the server. Try again in a moment.';
        if (problem) {
          code = problem.code;
          message = problem.message;
        } else {
          log.error({ err, bookId }, 'play failed');
        }
        await send(stream, { type: 'error', code, message, play: await playView(deps.db, bookId) });
      }
    })();
  }

  /** The play as the page shows it. */
  r.get('/books/:id/play', async (c) => {
    const userId = c.var.login.id;
    const bookId = await ownBookId(userId, c.req.param('id'));
    await writeTheBook(deps, userId, bookId);
    return c.json(await playView(deps.db, bookId));
  });

  /** The first scene's openings, asked for unless they're offered already. Answers with the play. */
  r.post('/books/:id/play/openings', async (c) => {
    const userId = c.var.login.id;
    const bookId = await ownBookId(userId, c.req.param('id'));
    const ai = await procreatorFor(userId, c.req.raw.signal);
    try {
      await alone(bookId, () => askOpenings(ai, bookId));
    } catch (err) {
      rethrown(err);
    }
    return c.json(await playView(deps.db, bookId));
  });

  /** The owner opens the story with an opening offered, or their own. Streams play's events. */
  r.post('/books/:id/play/open', async (c) => {
    const ask = parse(OpenAsk, await readJson(c));
    const userId = c.var.login.id;
    const bookId = await ownBookId(userId, c.req.param('id'));
    const ai = await procreatorFor(userId, c.req.raw.signal);
    return streamSSE(c, (stream) => streamed(userId, bookId, stream, (watch) => openStory(ai, bookId, ask, watch)));
  });

  /** The owner's move, or a note as the author. Streams play's events. */
  r.post('/books/:id/play/move', async (c) => {
    const ask = parse(MoveAsk, await readJson(c));
    const userId = c.var.login.id;
    const bookId = await ownBookId(userId, c.req.param('id'));
    const ai = await procreatorFor(userId, c.req.raw.signal);
    return streamSSE(c, (stream) => streamed(userId, bookId, stream, (watch) => makeMove(ai, bookId, ask, watch)));
  });

  /** The owner goes on to the next scene. Streams play's events. */
  r.post('/books/:id/play/next', async (c) => {
    const going = parse(Going, await readJson(c));
    const userId = c.var.login.id;
    const bookId = await ownBookId(userId, c.req.param('id'));
    const ai = await procreatorFor(userId, c.req.raw.signal);
    return streamSSE(c, (stream) => streamed(userId, bookId, stream, (watch) => goOn(ai, bookId, going, watch)));
  });

  /** Another reply to the newest turn. Streams play's events. */
  r.post('/books/:id/play/again', async (c) => {
    const going = parse(Going, await readJson(c));
    const userId = c.var.login.id;
    const bookId = await ownBookId(userId, c.req.param('id'));
    const ai = await procreatorFor(userId, c.req.raw.signal);
    return streamSSE(c, (stream) => streamed(userId, bookId, stream, (watch) => another(ai, bookId, going, watch)));
  });

  /** The story has ended, and the owner finishes the book: its last scene is wrapped up. Streams play's events. */
  r.post('/books/:id/play/finish', async (c) => {
    const userId = c.var.login.id;
    const bookId = await ownBookId(userId, c.req.param('id'));
    const ai = await procreatorFor(userId, c.req.raw.signal);
    return streamSSE(c, (stream) => streamed(userId, bookId, stream, (watch) => finishStory(ai, bookId, watch)));
  });

    /** The one about to act is played by their actor this time. Streams play's events. */
  r.post('/books/:id/play/actor', async (c) => {
    const going = parse(Going, await readJson(c));
    const userId = c.var.login.id;
    const bookId = await ownBookId(userId, c.req.param('id'));
    const ai = await procreatorFor(userId, c.req.raw.signal);
    return streamSSE(c, (stream) => streamed(userId, bookId, stream, (watch) => letActorPlay(ai, bookId, going, watch)));
  });

  /** Takes the newest turn back. Answers with the play, and the owner's words for the box again (none for an actor's turn). */
  r.post('/books/:id/play/undo', async (c) => {
    const bookId = await ownBookId(c.var.login.id, c.req.param('id'));
    let voice: Voice = 'character';
    let words = '';
    try {
      const turn = await alone(bookId, () => undo(deps.db, bookId));
      voice = turn.voice as Voice;
      // An actor's turn holds the actor's answer, which isn't the owner's to send again.
      if (voice !== 'actor') {
        words = turn.input;
      }
    } catch (err) {
      rethrown(err);
    }
    const answer: Undone = { play: await playView(deps.db, bookId), voice, words };
    return c.json(answer);
  });

  /** Three moves the owner could make next. */
  r.post('/books/:id/play/hints', async (c) => {
    const userId = c.var.login.id;
    const bookId = await ownBookId(userId, c.req.param('id'));
    const ai = await procreatorFor(userId, c.req.raw.signal);
    let moves: string[] = [];
    try {
      moves = await alone(bookId, () => hintsFor(ai, bookId));
    } catch (err) {
      rethrown(err);
    }
    const answer: Hints = { moves };
    return c.json(answer);
  });

  return r;
}
