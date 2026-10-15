import type { ModelChoice } from '@writer/shared/protocol';
import { DEFAULT_THINKING } from '../ai/catalog.ts';
import { EVERY_SCENE, houseReach, ownAiNeeded } from '../ai/house.ts';
import { ProxyError } from '../ai/proxy.ts';
import { modelInUse, ownInUse, savedChoice, type InUse } from '../ai/settings.ts';
import { nextToWrite } from '../book/scribe.ts';
import type { Deps } from '../context.ts';
import { ApiError } from '../lib/errors.ts';
import type { Login } from '../lib/login.ts';

/*
 * What the routes that call Procreator share: the model an account's calls run on, and how they
 * say the AI is offline or didn't answer.
 */

export const offline = () => new ApiError(503, 'ai_offline', 'The AI is offline, so Procreator can’t help right now.');
export const failed = () => new ApiError(502, 'ai_failed', 'Procreator didn’t answer. Try again in a moment.');

/** A provider's words for an account that has reached its limit, as CLIProxyAPI passes them on. */
const LIMIT = /RESOURCE_EXHAUSTED|quota|rate.?limit/i;
/** Antigravity says when it's back: "Resets in 90h20m44s". */
const RESETS = /Resets in (?:(\d+)h)?(?:(\d+)m)?/i;

/** When a limit resets, as the owner reads it, or null when the provider didn't say. */
function resetsIn(message: string): string | null {
  const match = RESETS.exec(message);
  if (!match) {
    return null;
  }
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  if (hours > 1) {
    return `about ${hours} hours`;
  }
  if (hours === 1) {
    return 'about an hour';
  }
  if (minutes > 1) {
    return `${minutes} minutes`;
  }
  return null;
}

/**
 * What the owner is told when the model didn't answer. An account that reached its limit is told
 * so, with when it resets where the provider says, since trying again in a moment won't help.
 */
export function failedFrom(err: Error): ApiError {
  if (!LIMIT.test(err.message)) {
    return failed();
  }
  let until = 'for now';
  const resets = resetsIn(err.message);
  if (resets) {
    until = `until it resets in ${resets}`;
  }
  const message = `The AI account has reached its limit for this model, ${until}. Pick another model at the top to go on meanwhile.`;
  return new ApiError(429, 'ai_limit', message);
}

/** What a call is for: the book (null for a new book's setup) and the scene the work is in (1 for setup). */
export interface Work {
  bookId: string | null;
  scene: number;
}

/** The account's own model it picked, while its own AI still reaches it, else null. */
async function pickedOwn(deps: Deps, userId: string, saved: ModelChoice | null): Promise<InUse | null> {
  if (!saved || saved.source === 'house') {
    return null;
  }
  const own = await deps.own.find(deps.db, userId, saved.source, saved.model);
  if (!own) {
    return null;
  }
  return ownInUse(own, saved.thinking);
}

/** The first model of the account's own AI, for when what it picked can't serve, else null. */
async function anyOwn(deps: Deps, userId: string, saved: ModelChoice | null): Promise<InUse | null> {
  const models = await deps.own.models(deps.db, userId);
  const first = models[0];
  if (!first) {
    return null;
  }
  return ownInUse(first, saved?.thinking ?? DEFAULT_THINKING);
}

/**
 * The model the account's calls run on for this work: the one it picked from its own AI, else the
 * house's while the house writes this work for it, else any of its own. A 403 when the house
 * doesn't write the work and the account has no AI of its own (`own_ai_needed`), or a 503 while
 * the AI is offline.
 */
export async function modelFor(deps: Deps, login: Login, work: Work): Promise<InUse> {
  const saved = await savedChoice(deps.db, login.id);
  const picked = await pickedOwn(deps, login.id, saved);
  if (picked) {
    return picked;
  }
  const reach = await houseReach(deps.db, deps.env, login, work.bookId);
  if (work.scene <= reach) {
    try {
      return await houseModel(deps, saved);
    } catch (err) {
      const own = await anyOwn(deps, login.id, saved);
      if (own) {
        return own;
      }
      throw err;
    }
  }
  const own = await anyOwn(deps, login.id, saved);
  if (own) {
    return own;
  }
  throw ownAiNeeded();
}

/** The model the account picked from the house, or a 503 while the AI is offline. */
async function houseModel(deps: Deps, saved: ModelChoice | null): Promise<InUse> {
  const catalog = deps.catalog;
  if (!catalog) {
    throw offline();
  }
  let inUse: InUse | null;
  try {
    inUse = await modelInUse(catalog, saved);
  } catch (err) {
    if (err instanceof ProxyError) {
      throw offline();
    }
    throw err;
  }
  if (!inUse) {
    throw offline();
  }
  return inUse;
}

/**
 * Tells the scribe to write what's missing from the book, on the model the first chapter waiting
 * would be written on: after play changed something, and as the play or the book opens, so a
 * chapter that failed is tried again. On the house it writes only as far as the house writes for
 * the account. Nothing happens while the AI is offline, or where there's no scribe.
 */
export async function writeTheBook(deps: Deps, login: Login, bookId: string) {
  const scribe = deps.scribe;
  if (!scribe) {
    return;
  }
  const waiting = await nextToWrite(deps.db, bookId);
  if (!waiting) {
    return;
  }
  try {
    const inUse = await modelFor(deps, login, { bookId, scene: waiting.number });
    let through = EVERY_SCENE;
    if (inUse.choice.source === 'house') {
      through = await houseReach(deps.db, deps.env, login, bookId);
    }
    scribe.nudge({ db: deps.db, inUse, userId: login.id }, bookId, through);
  } catch (err) {
    if (!(err instanceof ApiError)) {
      throw err;
    }
  }
}
