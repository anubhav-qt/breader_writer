import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { PlayEvent } from '@writer/shared/play';
import { writeMissing, type Scribe } from '../src/book/scribe.ts';
import { users } from '../src/db/breader.ts';
import { chapters, scenes } from '../src/db/schema.ts';
import type { Procreator } from '../src/procreator/run.ts';
import { ORIGIN, account, address, call, deps, send, writer, type Writer } from './helpers.ts';
import { antigravity, catalogOf, fakeProxy, type FakeProxy, type Reply } from './proxy.ts';
import { aBook } from './stories.ts';

/*
 * The house (step 9): the owner's AI writes everything for the invited, and once the writer is
 * open to all, everyone else's first chapter: setup help, the first book's first scene, its wrap-up
 * and its chapter. Past that, they need their own AI.
 */

const db = deps.db;
const proxies: FakeProxy[] = [];

afterEach(async () => {
  for (const proxy of proxies.splice(0)) {
    await proxy.close();
  }
});

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

function offering(): Reply {
  const openings = [
    { opening: 'The night of the fire, Aiko wakes to bells.', where: 'The Lamp House', when: 'The night of the fire', who: ['Aiko'] },
    { opening: 'Ren pulls Aiko from the river.', where: 'The ferry', when: 'Dawn', who: ['Aiko', 'Ren'] },
    { opening: 'A letter from Sora comes, years too late.', where: 'The post office', when: 'Spring', who: ['Sora'] },
  ];
  return { calls: [{ name: 'offer_openings', args: { openings } }] };
}

const ENDING: Reply = {
  text: 'The doors close.',
  calls: [{ name: 'end_scene', args: { where: 'The north road', when: 'Two days later', who: ['Ren'] } }],
};

/** Someone not invited, on a writer open to all, with a first book and the replies in line. */
async function stranger(replies: Reply[]) {
  const proxy = await fakeProxy({ ...antigravity(), replies });
  proxies.push(proxy);
  const email = address('stranger');
  const { scribe, done } = testScribe();
  const app = writer({ WRITER_EMAILS: [], OPEN_TO_ALL: true }, catalogOf(proxy), scribe);
  const cookie = await account(email, true);
  const [user] = await deps.breader.select().from(users).where(eq(users.email, email));
  return { proxy, app, cookie, done, userId: user.id };
}

/** A play route's answer: the stream's events, or its JSON. */
async function ask(app: Writer, cookie: string, bookId: string, path: string, body: unknown = {}) {
  const headers: Record<string, string> = { origin: ORIGIN, 'content-type': 'application/json', cookie };
  const res = await app.request(`/v1/books/${bookId}/play/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  const type = res.headers.get('content-type') ?? '';
  if (!type.startsWith('text/event-stream')) {
    return { status: res.status, events: [] as PlayEvent[], body: JSON.parse(text) };
  }
  const events: PlayEvent[] = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      events.push(PlayEvent.parse(JSON.parse(line.slice('data: '.length))));
    }
  }
  return { status: res.status, events, body: null };
}

describe('the house', () => {
  it('writes a stranger’s first scene, wraps it up and writes its chapter, then asks for their own AI', async () => {
    const chapter = { text: '<title>The Ferry</title>\n<chapter>\nThe river was cold.\n</chapter>' };
    const replies = [offering(), { text: 'The river is cold.' }, ENDING, { text: 'Aiko crossed the river.' }, chapter];
    const { app, cookie, done, userId } = await stranger(replies);
    const before = await call(app, 'GET', '/v1/settings', cookie);
    expect(before.body.house).toBe('first_chapter');

    const { bookId } = await aBook(userId);
    await ask(app, cookie, bookId, 'openings');
    await ask(app, cookie, bookId, 'open', { kind: 'pick', opening: 1 });
    const ended = await ask(app, cookie, bookId, 'move', { voice: 'character', text: 'I leave.' });
    expect(ended.events.at(-1)).toMatchObject({ type: 'done', play: { stage: 'ended', next: { number: 2 } } });

    const r = await ask(app, cookie, bookId, 'next');
    expect(r.events[0]).toEqual({ type: 'finishing', scene: 1 });
    expect(r.events.at(-1)).toMatchObject({ type: 'error', code: 'own_ai_needed', play: { stage: 'ended' } });
    await done();

    const [first] = await db.select().from(scenes).where(and(eq(scenes.bookId, bookId), eq(scenes.number, 1)));
    expect(first.summary).toBe('Aiko crossed the river.');
    const written = await db.select().from(chapters).where(eq(chapters.bookId, bookId));
    expect(written.map((row) => row.title)).toEqual(['The Ferry']);
    const [second] = await db.select().from(scenes).where(and(eq(scenes.bookId, bookId), eq(scenes.number, 2)));
    expect(second.status).toBe('next');

    const after = await call(app, 'GET', '/v1/settings', cookie);
    expect(after.body.house).toBe('used');
  });

  it('writes nothing of a stranger’s second book', async () => {
    const { app, cookie, userId } = await stranger([offering()]);
    await aBook(userId);
    const { bookId } = await aBook(userId);
    const openings = await ask(app, cookie, bookId, 'openings');
    expect(openings.status).toBe(403);
    expect(openings.body.code).toBe('own_ai_needed');

    const mara = { id: '11111111-1111-4111-8111-111111111111', name: 'Mara', who: 'A ferrywoman', personality: '', past: '', notes: '' };
    const world = { genre: 'Fantasy', tone: '', setting: 'A drowned coast.', rules: '', notes: '' };
    const setup = { title: 'Salt', color: 'teal', length: 'novella', pov: 'third_close', darkness: 'mature', world, protagonist: mara, cast: [], relationships: [] };
    const blanks = await send(app, 'POST', '/v1/suggestions/blanks', cookie, { bookId: null, setup });
    expect(blanks.status).toBe(403);
    expect(blanks.body.code).toBe('own_ai_needed');
  });

  it('writes everything for the invited', async () => {
    const proxy = await fakeProxy({ ...antigravity(), replies: [offering()] });
    proxies.push(proxy);
    const email = address('invited');
    const app = writer({ WRITER_EMAILS: [email], OPEN_TO_ALL: true }, catalogOf(proxy));
    const cookie = await account(email, true);
    const [user] = await deps.breader.select().from(users).where(eq(users.email, email));
    await aBook(user.id);
    const { bookId } = await aBook(user.id);
    const openings = await ask(app, cookie, bookId, 'openings');
    expect(openings.status).toBe(200);
    const settings = await call(app, 'GET', '/v1/settings', cookie);
    expect(settings.body.house).toBe('always');
  });
});
