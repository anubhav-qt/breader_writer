import type { Catalog } from '../ai/catalog.ts';
import { ProxyError } from '../ai/proxy.ts';
import { modelInUse, savedChoice, type InUse } from '../ai/settings.ts';
import type { Deps } from '../context.ts';
import { ApiError } from '../lib/errors.ts';

/*
 * What the routes that call Procreator share: the model an account's calls run on, and how they
 * say the AI is offline or didn't answer.
 */

export const offline = () => new ApiError(503, 'ai_offline', 'The AI is offline, so Procreator can’t help right now.');
export const failed = () => new ApiError(502, 'ai_failed', 'Procreator didn’t answer. Try again in a moment.');

/** The model the account's calls run on, or a 503 while the AI is offline. */
export async function modelFor(deps: Deps, userId: string): Promise<{ catalog: Catalog; inUse: InUse }> {
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
