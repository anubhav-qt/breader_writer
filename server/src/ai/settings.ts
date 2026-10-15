import { eq } from 'drizzle-orm';
import { clampThinkingLevel, type Api, type Model } from '@writer/pi-ai';
import {
  ModelSource,
  ThinkingLevel,
  type HouseStanding,
  type ModelChoice,
  type ModelInfo,
  type Settings,
} from '@writer/shared/protocol';
import type { Db } from '../db/client.ts';
import { settings } from '../db/schema.ts';
import { log } from '../log.ts';
import { DEFAULT_MODELS, DEFAULT_THINKING, defaultIn, infoFor, type Catalog } from './catalog.ts';
import type { OwnAi, OwnModel } from './own/own.ts';
import { ProxyError } from './proxy.ts';

/*
 * The model an account's stories run on, and how hard it thinks: its own choice from settings,
 * or the default until it makes one. A choice comes from the house (the owner's proxy) or from the
 * account's own AI (step 9).
 */

/** What's shown while the proxy can't be reached: the account's choice, or the default. */
const OFFLINE_DEFAULT: ModelChoice = { source: 'house', model: DEFAULT_MODELS[0], thinking: DEFAULT_THINKING };

/** The account's choice, or null until it makes one. */
export async function savedChoice(db: Db, userId: string): Promise<ModelChoice | null> {
  const [row] = await db.select().from(settings).where(eq(settings.userId, userId));
  if (!row) {
    return null;
  }
  const thinking = ThinkingLevel.safeParse(row.thinking);
  const source = ModelSource.safeParse(row.source);
  if (!thinking.success || !source.success) {
    return null;
  }
  return { source: source.data, model: row.model, thinking: thinking.data };
}

export async function saveChoice(db: Db, userId: string, choice: ModelChoice) {
  const row = { userId, source: choice.source, model: choice.model, thinking: choice.thinking, updatedAt: new Date() };
  const changed = { source: row.source, model: row.model, thinking: row.thinking, updatedAt: row.updatedAt };
  await db.insert(settings).values(row).onConflictDoUpdate({ target: settings.userId, set: changed });
}

/** A model the account's story can run on, the key its calls take, and the choice it stands for. */
export interface InUse {
  model: Model<Api>;
  apiKey: string;
  choice: ModelChoice;
}

/**
 * What the story runs on from the house: the account's model if an account still serves it,
 * else the default, else the first served. Its thinking moves to the nearest level the model
 * takes. Null when the proxy serves no models at all. Throws a ProxyError while the proxy is down.
 */
export async function modelInUse(catalog: Catalog, saved: ModelChoice | null): Promise<InUse | null> {
  let model: Model<Api> | null = null;
  if (saved && saved.source === 'house') {
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
  return { model, apiKey: catalog.proxy.apiKey, choice: { source: 'house', model: model.id, thinking } };
}

/** A model of the account's own AI in use, its thinking moved to the nearest level it takes. */
export function ownInUse(own: OwnModel, thinking: ThinkingLevel): InUse {
  const level = clampThinkingLevel(own.model, thinking);
  return { model: own.model, apiKey: own.apiKey, choice: { source: own.source, model: own.model.id, thinking: level } };
}

/** The level nearest the one wanted among those a model takes, the way pi moves it: up first, then down. */
function nearestLevel(levels: ThinkingLevel[], wanted: ThinkingLevel): ThinkingLevel {
  if (levels.includes(wanted)) {
    return wanted;
  }
  const order = ThinkingLevel.options;
  const at = order.indexOf(wanted);
  for (let i = at + 1; i < order.length; i++) {
    if (levels.includes(order[i])) {
      return order[i];
    }
  }
  for (let i = at - 1; i >= 0; i--) {
    if (levels.includes(order[i])) {
      return order[i];
    }
  }
  return levels[0] ?? 'off';
}

/**
 * What settings say is in use among the models shown: the account's choice while it's there,
 * else the house's default, else the first. Null when there are none.
 */
function choiceAmong(models: ModelInfo[], saved: ModelChoice | null): ModelChoice | null {
  let info: ModelInfo | undefined;
  if (saved) {
    info = models.find((model) => model.source === saved.source && model.id === saved.model);
  }
  if (!info) {
    const house = models.filter((model) => model.source === 'house');
    const ids = new Set(house.map((model) => model.id));
    const fallback = defaultIn(ids);
    info = house.find((model) => model.id === fallback) ?? models[0];
  }
  if (!info) {
    return null;
  }
  const wanted = saved?.thinking ?? DEFAULT_THINKING;
  return { source: info.source, model: info.id, thinking: nearestLevel(info.thinkingLevels, wanted) };
}

/** What settings read: the database, the house's models (null where there's no proxy) and the accounts' own AI. */
export interface Sources {
  db: Db;
  catalog: Catalog | null;
  own: OwnAi;
}

/** The house's models, or null while it's offline. */
async function houseInfos(catalog: Catalog | null): Promise<ModelInfo[] | null> {
  if (!catalog) {
    return null;
  }
  try {
    return await catalog.infos();
  } catch (err) {
    if (err instanceof ProxyError) {
      log.warn({ err: err.message }, 'the proxy is down, so the house is offline');
      return null;
    }
    throw err;
  }
}

/**
 * What settings show: the choice in use, and every model the account can pick (the house's while
 * it writes anything for the account, then its own AI's), or none while there's nothing to pick
 * and the house is offline. With what the house writes for the account.
 */
export async function settingsFor(sources: Sources, userId: string, house: HouseStanding): Promise<Settings> {
  const saved = await savedChoice(sources.db, userId);
  const fallback = saved ?? OFFLINE_DEFAULT;
  let fromHouse: ModelInfo[] | null = [];
  if (house !== 'used') {
    fromHouse = await houseInfos(sources.catalog);
  }
  const own = await sources.own.models(sources.db, userId);
  const fromOwn = own.map((entry) => infoFor(entry.model, entry.source));
  const models = [...(fromHouse ?? []), ...fromOwn];
  if (models.length === 0 && fromHouse === null) {
    return { using: fallback, models: null, house };
  }
  const using = choiceAmong(models, saved) ?? fallback;
  return { using, models, house };
}
