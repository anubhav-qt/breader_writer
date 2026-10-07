import { Hono } from 'hono';
import { streamSSE, type SSEStreamingApi } from 'hono/streaming';
import { z } from 'zod';
import { ChatApprove, ChatRedo, ChatSay, type BookChat, type ChatEvent } from '@writer/shared/chat';
import { BlanksAsk, FieldAsk, type BlankSuggestion, type BlankSuggestions, type FieldSuggestion } from '@writer/shared/suggestions';
import type { Catalog } from '../ai/catalog.ts';
import { ModelError } from '../ai/call.ts';
import { ProxyError } from '../ai/proxy.ts';
import { modelInUse, savedChoice, type InUse } from '../ai/settings.ts';
import { findBook } from '../books/setup.ts';
import type { AppEnv, Deps } from '../context.ts';
import { requireWriter } from '../lib/access.ts';
import { ApiError, parse, readJson } from '../lib/errors.ts';
import { log } from '../log.ts';
import { suggestBlanks } from '../suggestions/blanks.ts';
import { alone, approve, ChatError, redo, say } from '../suggestions/chat.ts';
import { bookChat, findChat, readChat, startChat, type ChatRow } from '../suggestions/chats.ts';
import { suggestField } from '../suggestions/field.ts';
import type { Helper } from '../suggestions/quick.ts';

const offline = () => new ApiError(503, 'ai_offline', 'The AI is offline, so Procreator can’t help right now.');
const failed = () => new ApiError(502, 'ai_failed', 'Procreator didn’t answer. Try again in a moment.');
const noChat = () => new ApiError(404, 'not_found', 'There’s no such chat here.');

/** Sends one of the chat's events down the stream. */
async function send(stream: SSEStreamingApi, event: ChatEvent) {
  await stream.writeSSE({ data: JSON.stringify(event) });
}

export function suggestionRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();
  r.use('/suggestions/*', requireWriter(deps));

  /** The model the account's setup help runs on, or a 503 while the AI is offline. */
  async function modelFor(userId: string): Promise<{ catalog: Catalog; inUse: InUse }> {
    const catalog = deps.catalog;
    if (!catalog) {
      throw offline();
    }
    let inUse: InUse | null;
    try {
      inUse = await modelInUse(catalog, await savedChoice(deps.db, userId));
    } catch (err) {
      if (err instanceof ProxyError) {
        throw offline();
      }
      throw err;
    }
    if (!inUse) {
      throw offline();
    }
    return { catalog, inUse };
  }

  /** The book a call is for, only if it's the account's own. */
  async function ownBookId(userId: string, bookId: string | null): Promise<string | null> {
    if (!bookId) {
      return null;
    }
    const book = await findBook(deps.db, userId, bookId);
    if (!book) {
      return null;
    }
    return book.id;
  }

  /** Procreator's suggestions for every blank field on the page, made together from the page as it stands. */
  r.post('/suggestions/blanks', async (c) => {
    const ask = parse(BlanksAsk, await readJson(c));
    const userId = c.var.login.id;
    const { catalog, inUse } = await modelFor(userId);
    const bookId = await ownBookId(userId, ask.bookId);
    const helper: Helper = { db: deps.db, catalog, inUse, userId, bookId, signal: c.req.raw.signal };
    let fields: BlankSuggestion[];
    try {
      fields = await suggestBlanks(helper, ask.setup);
    } catch (err) {
      if (err instanceof ModelError) {
        log.warn({ err: err.message, model: inUse.choice.model }, 'the suggestions for blank fields failed');
        throw failed();
      }
      throw err;
    }
    const answer: BlankSuggestions = { fields };
    return c.json(answer);
  });

  /** The account's chat with the id in the path, or a 404 for anyone else's or none. */
  async function ownChat(userId: string, raw: string): Promise<ChatRow> {
    const id = z.uuid().safeParse(raw);
    if (!id.success) {
      throw noChat();
    }
    const chat = await findChat(deps.db, userId, id.data);
    if (!chat) {
      throw noChat();
    }
    return chat;
  }

  /** The chat to say something in: the one asked for, or the book's, or a new one. */
  async function chatToSay(userId: string, ask: ChatSay): Promise<ChatRow> {
    if (ask.chatId) {
      return ownChat(userId, ask.chatId);
    }
    const bookId = await ownBookId(userId, ask.bookId);
    if (bookId) {
      const kept = await bookChat(deps.db, userId, bookId);
      if (kept) {
        return kept;
      }
    }
    return startChat(deps.db, userId, bookId);
  }

  /** What the chat can't do, as the owner is told it. */
  function chatProblem(err: unknown): ApiError | null {
    if (err instanceof ChatError) {
      return new ApiError(409, 'chat_conflict', err.message);
    }
    if (err instanceof ModelError) {
      log.warn({ err: err.message }, 'the Suggestions chat got no answer');
      return failed();
    }
    return null;
  }

  /** A book's Suggestions chat, or null before it has one. */
  r.get('/suggestions/chats', async (c) => {
    const userId = c.var.login.id;
    const raw = c.req.query('book') ?? '';
    const bookId = z.uuid().safeParse(raw);
    let answer: BookChat = { chat: null };
    if (bookId.success) {
      const chat = await bookChat(deps.db, userId, bookId.data);
      if (chat) {
        answer = { chat: await readChat(deps.db, chat) };
      }
    }
    return c.json(answer);
  });

  /** A Suggestions chat, as it shows. */
  r.get('/suggestions/chats/:id', async (c) => {
    const chat = await ownChat(c.var.login.id, c.req.param('id'));
    return c.json(await readChat(deps.db, chat));
  });

  /**
   * The owner says something in the chat (starting it, if it's new), and Procreator answers.
   * Streams server-sent events: the chat's id, Procreator's words as it writes them, then the
   * chat as it stands, or why it couldn't answer.
   */
  r.post('/suggestions/chats', async (c) => {
    const ask = parse(ChatSay, await readJson(c));
    const userId = c.var.login.id;
    const { catalog, inUse } = await modelFor(userId);
    const chat = await chatToSay(userId, ask);
    const helper: Helper = { db: deps.db, catalog, inUse, userId, bookId: chat.bookId, signal: c.req.raw.signal };
    return streamSSE(c, async (stream) => {
      await send(stream, { type: 'started', chatId: chat.id });
      try {
        const answered = await alone(chat.id, () =>
          say(helper, chat, ask.setup, ask.text, (delta) => {
            void send(stream, { type: 'text', delta });
          }),
        );
        await send(stream, { type: 'done', chat: answered });
      } catch (err) {
        const problem = chatProblem(err);
        if (!problem) {
          log.error({ err }, 'the Suggestions chat failed');
        }
        let code = 'server_error';
        let message = 'Something went wrong on the server. Try again in a moment.';
        if (problem) {
          code = problem.code;
          message = problem.message;
        }
        const kept = await readChat(deps.db, chat);
        await send(stream, { type: 'error', code, message, chat: kept });
      }
    });
  });

  /** One item of the open list redone, as the owner's notes on it say. Answers with the chat. */
  r.post('/suggestions/chats/:id/redo', async (c) => {
    const ask = parse(ChatRedo, await readJson(c));
    const userId = c.var.login.id;
    const chat = await ownChat(userId, c.req.param('id'));
    const { catalog, inUse } = await modelFor(userId);
    const helper: Helper = { db: deps.db, catalog, inUse, userId, bookId: chat.bookId, signal: c.req.raw.signal };
    try {
      const answered = await alone(chat.id, () => redo(helper, chat, ask.setup, ask.entry, ask.item, ask.notes));
      return c.json(answered);
    } catch (err) {
      const problem = chatProblem(err);
      if (problem) {
        throw problem;
      }
      throw err;
    }
  });

  /** The owner approves the open list, which lands on the page. Answers with the chat. */
  r.post('/suggestions/chats/:id/approve', async (c) => {
    const ask = parse(ChatApprove, await readJson(c));
    const chat = await ownChat(c.var.login.id, c.req.param('id'));
    try {
      const answered = await approve(deps, chat, ask.entry);
      return c.json(answered);
    } catch (err) {
      const problem = chatProblem(err);
      if (problem) {
        throw problem;
      }
      throw err;
    }
  });

  /** Procreator's suggestion for a field with text in it, once it's clicked into, made from the page as it stands. */
  r.post('/suggestions/field', async (c) => {
    const ask = parse(FieldAsk, await readJson(c));
    const userId = c.var.login.id;
    const { catalog, inUse } = await modelFor(userId);
    const bookId = await ownBookId(userId, ask.bookId);
    const helper: Helper = { db: deps.db, catalog, inUse, userId, bookId, signal: c.req.raw.signal };
    let text: string | null;
    try {
      text = await suggestField(helper, ask.setup, ask.field);
    } catch (err) {
      if (err instanceof ModelError) {
        log.warn({ err: err.message, model: inUse.choice.model }, 'a field suggestion failed');
        throw failed();
      }
      throw err;
    }
    if (text === null) {
      throw new ApiError(400, 'no_field', 'That field isn’t on the page.');
    }
    const answer: FieldSuggestion = { text };
    return c.json(answer);
  });

  return r;
}
