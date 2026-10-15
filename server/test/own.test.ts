import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { PlayEvent } from '@writer/shared/play';
import { OwnAi } from '../src/ai/own/own.ts';
import { prefixFor } from '../src/ai/own/signins.ts';
import { sealingKey, seal, unseal } from '../src/ai/own/seal.ts';
import { writeMissing, type Scribe } from '../src/book/scribe.ts';
import { users } from '../src/db/breader.ts';
import { chapters, ownKeys, scenes } from '../src/db/schema.ts';
import type { Procreator } from '../src/procreator/run.ts';
import { ORIGIN, SEALING, account, address, call, deps, send, writer, type Writer } from './helpers.ts';
import { API_KEY, MANAGEMENT_KEY, antigravity, catalogOf, fakeProxy, type FakeProxy, type Reply } from './proxy.ts';
import { aBook } from './stories.ts';

/*
 * A writer's own AI (step 9): API keys kept sealed and checked with their provider first, their
 * models in the picker, and calls going straight to the provider with the writer's key.
 */

const db = deps.db;
const proxies: FakeProxy[] = [];

afterEach(async () => {
  for (const proxy of proxies.splice(0)) {
    await proxy.close();
  }
});

async function standIn(replies: Reply[] = []) {
  const proxy = await fakeProxy({ ...antigravity(), replies });
  proxies.push(proxy);
  return proxy;
}

/** The accounts' own AI, with every provider at this stand-in. */
function ownAt(provider: FakeProxy, sealing: Buffer | null = SEALING) {
  const urls = { google: `${provider.url}/v1beta`, anthropic: provider.url, openai: `${provider.url}/v1` };
  return new OwnAi(sealing, urls);
}

/** The accounts' own AI, with sign-ins on this stand-in for the writers' proxy, and no provider keys. */
function signInsAt(writers: FakeProxy) {
  const proxy = { url: writers.url, apiKey: API_KEY, managementKey: MANAGEMENT_KEY };
  return new OwnAi(SEALING, { google: '', anthropic: '', openai: '' }, proxy);
}

/** Finishes a sign-in at the stand-in, the way the provider's page would: a credential appears. */
function signedIn(writers: FakeProxy, state: string, name: string, email: string) {
  const pending = writers.signIns.get(state);
  if (!pending) {
    throw new Error(`no sign-in ${state}`);
  }
  pending.status = 'ok';
  const credentials = writers.served.credentials ?? [];
  credentials.push({ name, provider: 'antigravity', email, status: 'active' });
  writers.served.credentials = credentials;
}

/** A scribe that writes when nudged, as far as it's told, and lets a test wait for it. */
function testScribe() {
  let writing: Promise<number> = Promise.resolve(0);
  const scribe: Scribe = {
    nudge: (ai: Procreator, bookId: string, through?: number) => {
      writing = writing.then(() => writeMissing(ai, bookId, through)).catch(() => 0);
    },
    busy: () => false,
  };
  return { scribe, done: () => writing };
}

async function userIdOf(email: string) {
  const [user] = await deps.breader.select().from(users).where(eq(users.email, email));
  return user.id;
}

/** A play route's events. */
async function play(app: Writer, cookie: string, bookId: string, path: string, body: unknown = {}) {
  const headers: Record<string, string> = { origin: ORIGIN, 'content-type': 'application/json', cookie };
  const res = await app.request(`/v1/books/${bookId}/play/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  const events: PlayEvent[] = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      events.push(PlayEvent.parse(JSON.parse(line.slice('data: '.length))));
    }
  }
  return { status: res.status, events, text };
}

function offering(): Reply {
  const openings = [
    { opening: 'The night of the fire, Aiko wakes to bells.', where: 'The Lamp House', when: 'The night of the fire', who: ['Aiko'] },
    { opening: 'Ren pulls Aiko from the river.', where: 'The ferry', when: 'Dawn', who: ['Aiko', 'Ren'] },
    { opening: 'A letter from Sora comes, years too late.', where: 'The post office', when: 'Spring', who: ['Sora'] },
  ];
  return { calls: [{ name: 'offer_openings', args: { openings } }] };
}

describe('sealing keys', () => {
  it('opens what it sealed, and nothing sealed with another secret', () => {
    const sealed = seal(SEALING, 'AIzaSyExample1234');
    expect(sealed).not.toContain('AIzaSyExample1234');
    expect(unseal(SEALING, sealed)).toBe('AIzaSyExample1234');
    expect(unseal(sealingKey('another secret for sealing keys, also long'), sealed)).toBeNull();
    expect(unseal(SEALING, 'not a seal')).toBeNull();
  });
});

describe('own keys', () => {
  it('keeps a key the provider takes, sealed, and shows only its last four characters', async () => {
    const provider = await standIn();
    const email = address('own');
    const app = writer({ WRITER_EMAILS: [email] }, null, null, ownAt(provider));
    const cookie = await account(email, true);

    const refused = await send(app, 'PUT', '/v1/own/keys/google', cookie, { key: 'not-the-right-key' });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ code: 'key_refused', message: 'Google turned that key away.' });

    const kept = await send(app, 'PUT', '/v1/own/keys/google', cookie, { key: API_KEY });
    expect(kept.status).toBe(200);
    expect(kept.body).toEqual({ keys: [{ provider: 'google', hint: API_KEY.slice(-4) }], signIns: [], keysHere: true, signInsHere: false });
    const [row] = await db.select().from(ownKeys).where(eq(ownKeys.userId, await userIdOf(email)));
    expect(row.sealed).not.toContain(API_KEY);

    const unknown = await send(app, 'PUT', '/v1/own/keys/mistral', cookie, { key: API_KEY });
    expect(unknown.status).toBe(404);

    const removed = await call(app, 'DELETE', '/v1/own/keys/google', cookie);
    expect(removed.body.keys).toEqual([]);
  });

  it('takes no keys on a server without KEYS_SECRET', async () => {
    const provider = await standIn();
    const email = address('own');
    const app = writer({ WRITER_EMAILS: [email] }, null, null, ownAt(provider, null));
    const cookie = await account(email, true);
    const view = await call(app, 'GET', '/v1/own', cookie);
    expect(view.body.keysHere).toBe(false);
    const r = await send(app, 'PUT', '/v1/own/keys/google', cookie, { key: API_KEY });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('keys_off');
  });

  it('adds the models a key reaches to the picker, and runs the story on the one picked, with the key', async () => {
    const house = await standIn([offering()]);
    const provider = await standIn([offering()]);
    const email = address('own');
    const app = writer({ WRITER_EMAILS: [email] }, catalogOf(house), null, ownAt(provider));
    const cookie = await account(email, true);
    await send(app, 'PUT', '/v1/own/keys/google', cookie, { key: API_KEY });
    await send(app, 'PUT', '/v1/own/keys/anthropic', cookie, { key: API_KEY });

    const settings = await call(app, 'GET', '/v1/settings', cookie);
    const listed = settings.body.models.map((model: { source: string; id: string }) => `${model.source} ${model.id}`);
    expect(listed).toContain('house gemini-3.8-flash-high');
    expect(listed).toContain('google gemini-3.8-flash-high');
    expect(listed).toContain('anthropic claude-sonnet-4-6');
    expect(listed).not.toContain('google gemini-3.1-flash-image');
    expect(settings.body.using).toEqual({ source: 'house', model: 'gemini-3.8-flash-high', thinking: 'high' });

    const pick = { source: 'google', model: 'gemini-3.8-flash-high', thinking: 'high' };
    const picked = await send(app, 'PUT', '/v1/settings', cookie, pick);
    expect(picked.body.using).toEqual(pick);
    const wrong = await send(app, 'PUT', '/v1/settings', cookie, { source: 'openai', model: 'gemini-3.8-flash-high', thinking: 'high' });
    expect(wrong.status).toBe(400);

    const { bookId } = await aBook(await userIdOf(email));
    const openings = await play(app, cookie, bookId, 'openings');
    expect(openings.status).toBe(200);
    expect(provider.asked).toHaveLength(1);
    expect(house.asked).toHaveLength(0);

    // Without the key, the picker falls back to the house.
    await call(app, 'DELETE', '/v1/own/keys/google', cookie);
    const after = await call(app, 'GET', '/v1/settings', cookie);
    expect(after.body.using).toEqual({ source: 'house', model: 'gemini-3.8-flash-high', thinking: 'high' });
  });

  it('lets a stranger go on past the free chapter with their own key, while the house still writes that chapter', async () => {
    const ending = {
      text: 'The doors close.',
      calls: [{ name: 'end_scene', args: { where: 'The north road', when: 'Two days later', who: ['Ren'] } }],
    };
    const chapter = { text: '<title>The Ferry</title>\n<chapter>\nThe river was cold.\n</chapter>' };
    const house = await standIn([offering(), { text: 'The river is cold.' }, ending, chapter]);
    const provider = await standIn([{ text: 'Aiko crossed the river.' }, { text: 'Rain followed them.' }]);
    const email = address('stranger');
    const { scribe, done } = testScribe();
    const app = writer({ WRITER_EMAILS: [], OPEN_TO_ALL: true }, catalogOf(house), scribe, ownAt(provider));
    const cookie = await account(email, true);
    const { bookId } = await aBook(await userIdOf(email));
    await play(app, cookie, bookId, 'openings');
    await play(app, cookie, bookId, 'open', { kind: 'pick', opening: 1 });
    await play(app, cookie, bookId, 'move', { voice: 'character', text: 'I leave.' });

    await send(app, 'PUT', '/v1/own/keys/google', cookie, { key: API_KEY });
    const r = await play(app, cookie, bookId, 'next');
    expect(r.events.at(-1)).toMatchObject({ type: 'done', play: { stage: 'playing', scene: { number: 2 } } });
    await done();

    expect(provider.asked).toHaveLength(2);
    const [first] = await db.select().from(scenes).where(and(eq(scenes.bookId, bookId), eq(scenes.number, 1)));
    expect(first.summary).toBe('Aiko crossed the river.');
    const written = await db.select().from(chapters).where(eq(chapters.bookId, bookId));
    expect(written.map((row) => row.title)).toEqual(['The Ferry']);
    expect(house.asked).toHaveLength(4);
  });
});

describe('own sign-ins', () => {
  it('signs a writer’s subscription in under their prefix, so only their calls reach it', async () => {
    const writers = await fakeProxy({ ...antigravity(), credentials: [], replies: [offering()] });
    proxies.push(writers);
    const own = signInsAt(writers);
    const mine = address('mine');
    const theirs = address('theirs');
    const app = writer({ WRITER_EMAILS: [mine, theirs] }, null, null, own);
    const myCookie = await account(mine, true);
    const theirCookie = await account(theirs, true);
    const me = await userIdOf(mine);

    const started = await send(app, 'POST', '/v1/own/sign-in', myCookie, { provider: 'antigravity' });
    expect(started.status).toBe(200);
    const state = started.body.state;
    const busy = await send(app, 'POST', '/v1/own/sign-in', theirCookie, { provider: 'antigravity' });
    expect(busy.status).toBe(409);
    expect(busy.body.code).toBe('sign_in_busy');
    const notTheirs = await call(app, 'GET', `/v1/own/sign-in/${state}`, theirCookie);
    expect(notTheirs.status).toBe(404);

    const waiting = await call(app, 'GET', `/v1/own/sign-in/${state}`, myCookie);
    expect(waiting.body.status).toBe('wait');
    signedIn(writers, state, 'antigravity-mine.json', 'mine@gmail.example');
    const done = await call(app, 'GET', `/v1/own/sign-in/${state}`, myCookie);
    expect(done.body.status).toBe('ok');
    expect(writers.served.credentials?.[0].prefix).toBe(prefixFor(me));

    const view = await call(app, 'GET', '/v1/own', myCookie);
    expect(view.body.signIns).toEqual([{ id: 'antigravity-mine.json', provider: 'antigravity', name: 'mine@gmail.example', problem: null }]);
    expect(view.body.signInsHere).toBe(true);
    const others = await call(app, 'GET', '/v1/own', theirCookie);
    expect(others.body.signIns).toEqual([]);

    const settings = await call(app, 'GET', '/v1/settings', myCookie);
    const model = `${prefixFor(me)}/gemini-3.8-flash-high`;
    const ours = settings.body.models.filter((info: { source: string }) => info.source === 'signin');
    expect(ours.map((info: { id: string; name: string }) => [info.id, info.name])).toContainEqual([model, 'Gemini 3.8 Flash']);
    const theirSettings = await call(app, 'GET', '/v1/settings', theirCookie);
    // With no AI of their own and no house here, they have nothing to pick.
    expect(theirSettings.body.models).toBeNull();

    await send(app, 'PUT', '/v1/settings', myCookie, { source: 'signin', model, thinking: 'high' });
    const { bookId } = await aBook(me);
    const openings = await play(app, myCookie, bookId, 'openings');
    expect(openings.status).toBe(200);
    expect(writers.asked.map((asked) => asked.model)).toEqual([model]);

    const refused = await call(app, 'DELETE', '/v1/own/sign-ins/antigravity-mine.json', theirCookie);
    expect(refused.status).toBe(404);
    const out = await call(app, 'DELETE', '/v1/own/sign-ins/antigravity-mine.json', myCookie);
    expect(out.body.signIns).toEqual([]);
    expect(writers.served.credentials).toEqual([]);
  });

  it('signs out what nobody owns before a sign-in starts, so it’s never taken for someone else’s', async () => {
    const left = { name: 'left-over.json', provider: 'antigravity', email: 'nobody@example.com' };
    const writers = await fakeProxy({ ...antigravity(), credentials: [left] });
    proxies.push(writers);
    const email = address('own');
    const app = writer({ WRITER_EMAILS: [email] }, null, null, signInsAt(writers));
    const cookie = await account(email, true);
    const started = await send(app, 'POST', '/v1/own/sign-in', cookie, { provider: 'antigravity' });
    expect(started.status).toBe(200);
    expect(writers.served.credentials).toEqual([]);
  });

  it('takes no sign-ins where there’s no writers’ proxy', async () => {
    const email = address('own');
    const app = writer({ WRITER_EMAILS: [email] });
    const cookie = await account(email, true);
    const r = await send(app, 'POST', '/v1/own/sign-in', cookie, { provider: 'antigravity' });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('sign_ins_off');
  });
});
