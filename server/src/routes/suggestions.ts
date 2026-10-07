import { Hono } from 'hono';
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
import { suggestField } from '../suggestions/field.ts';
import type { Helper } from '../suggestions/quick.ts';

const offline = () => new ApiError(503, 'ai_offline', 'The AI is offline, so Procreator can’t help right now.');
const failed = () => new ApiError(502, 'ai_failed', 'Procreator didn’t answer. Try again in a moment.');

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
