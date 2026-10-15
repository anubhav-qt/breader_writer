import { and, asc, eq } from 'drizzle-orm';
import type { Api, Model } from '@writer/pi-ai';
import type { KeyProvider, ModelSource, OwnKey } from '@writer/shared/protocol';
import type { Db } from '../../db/client.ts';
import { ownKeys } from '../../db/schema.ts';
import { log } from '../../log.ts';
import { Catalog } from '../catalog.ts';
import { ProxyError, type Proxy } from '../proxy.ts';
import { KeyError, modelsWithKey, type ProviderUrls } from './providers.ts';
import { seal, unseal } from './seal.ts';
import { prefixFor, WritersSignIns } from './signins.ts';

/*
 * An account's own AI (step 9): its API keys, kept sealed, its sign-ins on the writers' proxy
 * (signins.ts), and the models they reach, read again once a minute at most. Calls with a key go
 * straight to the provider, and through a sign-in to the writers' proxy under the account's
 * prefix, so either way they draw on the account's own limits and nobody else's.
 */

const FRESH_FOR_MS = 60_000;

/** A model from an account's own AI: where it comes from, and the key its calls take. */
export interface OwnModel {
  source: ModelSource;
  model: Model<Api>;
  apiKey: string;
}

interface Read {
  at: number;
  models: OwnModel[];
}

/** This server takes no keys: it has no KEYS_SECRET. */
export class KeysOff extends Error {
  constructor() {
    super('This server takes no keys.');
    this.name = 'KeysOff';
  }
}

export class OwnAi {
  /** What keys are sealed with, or null where KEYS_SECRET isn't set and no keys are taken. */
  readonly sealing: Buffer | null;
  readonly urls: ProviderUrls;
  /** The sign-ins on the writers' proxy, or null where it doesn't run and none are taken. */
  readonly signIns: WritersSignIns | null;
  /** The writers' proxy's models, every writer's under their prefix. */
  private readonly signedIn: Catalog | null;
  private read = new Map<string, Read>();

  constructor(sealing: Buffer | null, urls: ProviderUrls, writersProxy: Proxy | null = null) {
    this.sealing = sealing;
    this.urls = urls;
    this.signIns = null;
    this.signedIn = null;
    if (writersProxy) {
      this.signIns = new WritersSignIns(writersProxy);
      this.signedIn = new Catalog(writersProxy);
    }
  }

  /** The account's keys as settings show them: the provider and the key's last four characters. */
  async keys(db: Db, userId: string): Promise<OwnKey[]> {
    const rows = await db.select().from(ownKeys).where(eq(ownKeys.userId, userId)).orderBy(asc(ownKeys.provider));
    return rows.map((row) => ({ provider: row.provider as KeyProvider, hint: row.hint }));
  }

  /** Checks a key with its provider, then keeps it, sealed, in place of the one before. Throws a KeyError when it doesn't work. */
  async saveKey(db: Db, userId: string, provider: KeyProvider, key: string): Promise<void> {
    if (!this.sealing) {
      throw new KeysOff();
    }
    await modelsWithKey(provider, this.urls, key);
    const sealed = seal(this.sealing, key);
    const hint = key.slice(-4);
    await db
      .insert(ownKeys)
      .values({ userId, provider, sealed, hint })
      .onConflictDoUpdate({ target: [ownKeys.userId, ownKeys.provider], set: { sealed, hint, createdAt: new Date() } });
    this.forget(userId);
  }

  async removeKey(db: Db, userId: string, provider: KeyProvider): Promise<void> {
    await db.delete(ownKeys).where(and(eq(ownKeys.userId, userId), eq(ownKeys.provider, provider)));
    this.forget(userId);
  }

  /** Lets go of what it read for the account, so the next ask reads its AI again. */
  forget(userId: string) {
    this.read.delete(userId);
  }

  /** Lets go of what it read, the writers' proxy's models included: a sign-in came or went. */
  forgetSignIns(userId: string) {
    this.forget(userId);
    this.signedIn?.forget();
  }

  /**
   * The models the account's sign-ins serve, called as `<prefix>/<model>`. The writers' proxy lists
   * each writer's under their prefix; one that lists them without gets the account's prefix put on
   * the models of the kinds it signed in.
   */
  private async modelsOfSignIns(db: Db, userId: string): Promise<OwnModel[]> {
    const signIns = this.signIns;
    const catalog = this.signedIn;
    if (!signIns || !catalog) {
      return [];
    }
    const providers = await signIns.providersOf(db, userId);
    if (providers.size === 0) {
      return [];
    }
    let all: Model<Api>[];
    try {
      all = await catalog.models();
    } catch (err) {
      if (!(err instanceof ProxyError)) {
        throw err;
      }
      log.warn({ err: err.message }, 'the writers’ proxy can’t be reached, so its sign-ins serve no models');
      return [];
    }
    const prefix = `${prefixFor(userId)}/`;
    const apiKey = signIns.proxy.apiKey;
    const prefixed = all.some((model) => model.id.includes('/'));
    const models: OwnModel[] = [];
    for (const model of all) {
      if (prefixed && model.id.startsWith(prefix)) {
        models.push({ source: 'signin', model, apiKey });
      }
      if (!prefixed && providers.has(model.provider)) {
        models.push({ source: 'signin', model: { ...model, id: prefix + model.id }, apiKey });
      }
    }
    return models;
  }

  /** The models each of the account's keys reaches. A key that can't be opened or used adds none. */
  private async modelsOfKeys(db: Db, userId: string): Promise<OwnModel[]> {
    const sealing = this.sealing;
    if (!sealing) {
      return [];
    }
    const rows = await db.select().from(ownKeys).where(eq(ownKeys.userId, userId)).orderBy(asc(ownKeys.provider));
    const models: OwnModel[] = [];
    for (const row of rows) {
      const provider = row.provider as KeyProvider;
      const apiKey = unseal(sealing, row.sealed);
      if (apiKey === null) {
        log.warn({ provider }, 'an own key can’t be opened: KEYS_SECRET changed since it was kept');
        continue;
      }
      try {
        const reached = await modelsWithKey(provider, this.urls, apiKey);
        for (const model of reached) {
          models.push({ source: provider, model, apiKey });
        }
      } catch (err) {
        if (!(err instanceof KeyError)) {
          throw err;
        }
        log.warn({ provider, err: err.message }, 'an own key reaches no models right now');
      }
    }
    return models;
  }

  /** Every model the account's own AI reaches, read again once a minute at most. */
  async models(db: Db, userId: string): Promise<OwnModel[]> {
    const kept = this.read.get(userId);
    if (kept && Date.now() - kept.at < FRESH_FOR_MS) {
      return kept.models;
    }
    const ofKeys = await this.modelsOfKeys(db, userId);
    const ofSignIns = await this.modelsOfSignIns(db, userId);
    const models = [...ofKeys, ...ofSignIns];
    this.read.set(userId, { at: Date.now(), models });
    return models;
  }

  /** The model of this source and id, or null when the account's own AI doesn't reach it. */
  async find(db: Db, userId: string, source: ModelSource, id: string): Promise<OwnModel | null> {
    const models = await this.models(db, userId);
    const found = models.find((own) => own.source === source && own.model.id === id);
    return found ?? null;
  }
}
