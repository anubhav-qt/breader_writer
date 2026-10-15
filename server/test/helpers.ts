import { eq } from 'drizzle-orm';
import type { Catalog } from '../src/ai/catalog.ts';
import { OwnAi } from '../src/ai/own/own.ts';
import { PROVIDER_URLS } from '../src/ai/own/providers.ts';
import { sealingKey } from '../src/ai/own/seal.ts';
import type { Scribe } from '../src/book/scribe.ts';
import { makeApp } from '../src/app.ts';
import type { Deps } from '../src/context.ts';
import { users } from '../src/db/breader.ts';
import { breaderDb, makePool, writerDb } from '../src/db/client.ts';
import { loadEnv, type Env } from '../src/env.ts';
import { makeBreader, signUp } from './breader.ts';

export const ORIGIN = 'http://localhost:5174';
export const env = loadEnv();
export const pool = makePool(env.DATABASE_URL, { ssl: false, name: 'test' });
/** What tests seal keys with. */
export const SEALING = sealingKey('a test secret for sealing keys, long enough');
export const deps: Deps = { env, db: writerDb(pool), pool, breader: breaderDb(pool), catalog: null, own: new OwnAi(SEALING, PROVIDER_URLS), scribe: null };
export const breader = makeBreader(pool, { secure: false });

/**
 * The writer, with some settings changed for one test, its models from this catalog, a scribe when
 * a test wants the book written, and the accounts' own AI when a test brings it.
 */
export function writer(over: Partial<Env> = {}, catalog: Catalog | null = null, scribe: Scribe | null = null, own: OwnAi = deps.own) {
  return makeApp({ ...deps, env: { ...env, ...over }, catalog, scribe, own });
}

export type Writer = ReturnType<typeof writer>;

/** A new email address, so tests never share an account. */
export function address(who: string) {
  const id = Math.random().toString(36).slice(2, 10);
  return `${who}-${id}@example.com`;
}

/** Signs up on breader, confirming the email or not. Returns the browser's Cookie header. */
export async function account(email: string, confirmed: boolean): Promise<string> {
  const cookie = await signUp(breader, email);
  if (confirmed) {
    await deps.breader.update(users).set({ emailVerified: true }).where(eq(users.email, email));
  }
  return cookie;
}

/** A request from the app's own page, with this browser's cookies. */
export async function call(app: Writer, method: string, path: string, cookie = '', origin = ORIGIN) {
  const headers: Record<string, string> = { origin };
  if (cookie) {
    headers.cookie = cookie;
  }
  const res = await app.request(path, { method, headers });
  return answer(res);
}

/** A request with a JSON body from the app's own page, with this browser's cookies. */
export async function send(app: Writer, method: string, path: string, cookie: string, body: unknown) {
  const headers: Record<string, string> = { origin: ORIGIN, 'content-type': 'application/json' };
  if (cookie) {
    headers.cookie = cookie;
  }
  const res = await app.request(path, { method, headers, body: JSON.stringify(body) });
  return answer(res);
}

async function answer(res: Response) {
  const text = await res.text();
  let body = null;
  if (text) {
    body = JSON.parse(text);
  }
  return { status: res.status, body };
}
