import { FIRST_SCENE, houseReach, ownAiNeeded } from '../ai/house.ts';
import { ProxyError } from '../ai/proxy.ts';
import { modelInUse, savedChoice, type InUse } from '../ai/settings.ts';
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

/**
 * The model the account's calls run on for this work, a 403 past what the house writes for it
 * (`own_ai_needed`), or a 503 while the AI is offline.
 */
export async function modelFor(deps: Deps, login: Login, work: Work): Promise<InUse> {
  const reach = await houseReach(deps.db, deps.env, login, work.bookId);
  if (work.scene > reach) {
    throw ownAiNeeded();
  }
  return houseModel(deps, login.id);
}

/** The model the account picked from the house, or a 503 while the AI is offline. */
async function houseModel(deps: Deps, userId: string): Promise<InUse> {
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
  return inUse;
}

/**
 * Tells the scribe to write what's missing from the book, on the account's model: after play
 * changed something, and as the play or the book opens, so a chapter that failed is tried again.
 * On the house it writes only as far as the house writes for the account. Nothing happens while
 * the AI is offline, or where there's no scribe.
 */
export async function writeTheBook(deps: Deps, login: Login, bookId: string) {
  const scribe = deps.scribe;
  if (!scribe) {
    return;
  }
  const reach = await houseReach(deps.db, deps.env, login, bookId);
  if (reach < FIRST_SCENE) {
    return;
  }
  try {
    const inUse = await houseModel(deps, login.id);
    scribe.nudge({ db: deps.db, inUse, userId: login.id }, bookId, reach);
  } catch (err) {
    if (!(err instanceof ApiError)) {
      throw err;
    }
  }
}
