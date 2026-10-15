import { eq } from 'drizzle-orm';
import { clampThinkingLevel, type Api, type Model } from '@writer/pi-ai';
import { ThinkingLevel, type HouseStanding, type ModelChoice, type Settings } from '@writer/shared/protocol';
import type { Db } from '../db/client.ts';
import { settings } from '../db/schema.ts';
import { log } from '../log.ts';
import { DEFAULT_MODELS, DEFAULT_THINKING, defaultIn, type Catalog } from './catalog.ts';
import { ProxyError } from './proxy.ts';

/*
 * The model an account's stories run on, and how hard it thinks: its own choice from settings,
 * or the default until it makes one.
 */

/** What's shown while the proxy can't be reached: the account's choice, or the default. */
const OFFLINE_DEFAULT: ModelChoice = { model: DEFAULT_MODELS[0], thinking: DEFAULT_THINKING };

/** The account's choice, or null until it makes one. */
export async function savedChoice(db: Db, userId: string): Promise<ModelChoice | null> {
  const [row] = await db.select().from(settings).where(eq(settings.userId, userId));
  if (!row) {
    return null;
  }
  const thinking = ThinkingLevel.safeParse(row.thinking);
  if (!thinking.success) {
    return null;
  }
  return { model: row.model, thinking: thinking.data };
}

export async function saveChoice(db: Db, userId: string, choice: ModelChoice) {
  const row = { userId, model: choice.model, thinking: choice.thinking, updatedAt: new Date() };
  await db
    .insert(settings)
    .values(row)
    .onConflictDoUpdate({ target: settings.userId, set: { model: row.model, thinking: row.thinking, updatedAt: row.updatedAt } });
}

/** A model the account's story can run on, the key its calls take, and the choice it stands for. */
export interface InUse {
  model: Model<Api>;
  apiKey: string;
  choice: ModelChoice;
}

/**
 * What the story runs on now: the account's model if an account still serves it, else the
 * default, else the first served. Its thinking moves to the nearest level the model takes. Null
 * when the proxy serves no models at all. Throws a ProxyError while the proxy is down.
 */
export async function modelInUse(catalog: Catalog, saved: ModelChoice | null): Promise<InUse | null> {
  let model: Model<Api> | null = null;
  if (saved) {
    model = await catalog.find(saved.model);
  }
  if (!model) {
    const infos = await catalog.infos();
    const ids = new Set(infos.map((info) => info.id));
    const fallback = defaultIn(ids) ?? infos[0]?.id;
    if (fallback) {
      model = await catalog.find(fallback);
    }
  }
  if (!model) {
    return null;
  }
  const wanted = saved?.thinking ?? DEFAULT_THINKING;
  const thinking = clampThinkingLevel(model, wanted);
  return { model, apiKey: catalog.proxy.apiKey, choice: { model: model.id, thinking } };
}

/**
 * What settings show: the choice in use, and every model there is, or none while the AI is
 * offline, with what the house writes for the account.
 */
export async function settingsFor(db: Db, catalog: Catalog | null, userId: string, house: HouseStanding): Promise<Settings> {
  const saved = await savedChoice(db, userId);
  const offline: Settings = { using: saved ?? OFFLINE_DEFAULT, models: null, house };
  if (!catalog) {
    return offline;
  }
  try {
    const models = await catalog.infos();
    const inUse = await modelInUse(catalog, saved);
    if (!inUse) {
      return { using: offline.using, models, house };
    }
    return { using: inUse.choice, models, house };
  } catch (err) {
    if (err instanceof ProxyError) {
      log.warn({ err: err.message }, 'the proxy is down, so the AI is offline');
      return offline;
    }
    throw err;
  }
}
