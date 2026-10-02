import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { BookSetup, Character } from '@writer/shared/book';
import { account, address, call, send, writer } from './helpers.ts';

function sheet(name: string, over: Partial<Character> = {}): Character {
  return { id: randomUUID(), name, who: '', personality: '', past: '', feelings: {}, notes: '', ...over };
}

function setup(over: Partial<BookSetup> = {}): BookSetup {
  return {
    title: 'The Lantern Road',
    color: 'teal',
    length: 'novella',
    pov: 'third_close',
    darkness: 'mature',
    world: { genre: 'Fantasy', tone: '', setting: 'A river city, winter', rules: '', notes: '' },
    protagonist: sheet('Aiko', { who: 'A lamplighter' }),
    cast: [],
    ...over,
  };
}

/** A writer with one invited, confirmed account, and that account's cookie. */
async function invited() {
  const email = address('writer');
  const app = writer({ WRITER_EMAILS: [email] });
  const cookie = await account(email, true);
  return { app, cookie };
}

describe('POST /v1/books', () => {
  it('makes a book from its setup, with the word goal from its length', async () => {
    const { app, cookie } = await invited();
    const made = await send(app, 'POST', '/v1/books', cookie, setup({ length: 'light_novel' }));
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ title: 'The Lantern Road', color: 'teal', length: 'light_novel', wordGoal: 50000, wordsWritten: 0 });

    const list = await call(app, 'GET', '/v1/books', cookie);
    expect(list.body.books).toHaveLength(1);
    expect(list.body.books[0].id).toBe(made.body.id);
  });

  it('keeps the world, the cast in order and how they feel about each other', async () => {
    const { app, cookie } = await invited();
    const ren = sheet('Ren');
    const mei = sheet('Mei');
    const aiko = sheet('Aiko', { feelings: { [ren.id]: 'Trusts him too much', [mei.id]: '' } });
    ren.feelings = { [aiko.id]: 'Owes her his life' };
    const sent = setup({ protagonist: aiko, cast: [ren, mei] });

    const made = await send(app, 'POST', '/v1/books', cookie, sent);
    const read = await call(app, 'GET', `/v1/books/${made.body.id}/setup`, cookie);
    expect(read.status).toBe(200);
    // A blank feeling isn't kept.
    const kept = { ...sent, protagonist: { ...aiko, feelings: { [ren.id]: 'Trusts him too much' } } };
    expect(read.body).toEqual(kept);
  });

  it('trims what it keeps', async () => {
    const { app, cookie } = await invited();
    const made = await send(app, 'POST', '/v1/books', cookie, setup({ title: '  Spaced out  ' }));
    expect(made.body.title).toBe('Spaced out');
  });

  it('turns away a setup without a title, a protagonist without a name, or an unknown length', async () => {
    const { app, cookie } = await invited();

    const untitled = await send(app, 'POST', '/v1/books', cookie, setup({ title: '   ' }));
    expect(untitled.status).toBe(400);
    expect(untitled.body.message).toBe('The book needs a title. (title)');

    const nameless = await send(app, 'POST', '/v1/books', cookie, setup({ protagonist: sheet('') }));
    expect(nameless.status).toBe(400);
    expect(nameless.body.message).toBe('Every character needs a name. (protagonist.name)');

    const epic = { ...setup(), length: 'epic' };
    const tooLong = await send(app, 'POST', '/v1/books', cookie, epic);
    expect(tooLong.status).toBe(400);

    const list = await call(app, 'GET', '/v1/books', cookie);
    expect(list.body.books).toEqual([]);
  });

  it('turns away two characters with one id, and feelings about someone not in the cast', async () => {
    const { app, cookie } = await invited();
    const aiko = sheet('Aiko');

    const twins = await send(app, 'POST', '/v1/books', cookie, setup({ protagonist: aiko, cast: [{ ...sheet('Ren'), id: aiko.id }] }));
    expect(twins.status).toBe(400);

    const stranger = sheet('Aiko', { feelings: { [randomUUID()]: 'Who?' } });
    const ghost = await send(app, 'POST', '/v1/books', cookie, setup({ protagonist: stranger }));
    expect(ghost.status).toBe(400);
    expect(ghost.body.message).toBe('Aiko has a feeling about someone not in the cast.');

    const vain = sheet('Aiko');
    vain.feelings = { [vain.id]: 'Adores herself' };
    const mirror = await send(app, 'POST', '/v1/books', cookie, setup({ protagonist: vain }));
    expect(mirror.status).toBe(400);
  });

  it('isn’t open to accounts that can’t write', async () => {
    const app = writer({ WRITER_EMAILS: [] });
    const cookie = await account(address('stranger'), true);
    const r = await send(app, 'POST', '/v1/books', cookie, setup());
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('invite_only');
  });

  it('says so when the body isn’t JSON', async () => {
    const { app, cookie } = await invited();
    const r = await app.request('/v1/books', {
      method: 'POST',
      headers: { origin: 'http://localhost:5174', cookie, 'content-type': 'application/json' },
      body: '{ not json',
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as { code: string };
    expect(body.code).toBe('bad_json');
  });
});

describe('PUT /v1/books/:id/setup', () => {
  it('changes the settings, keeps who stays, adds who joins and removes who left', async () => {
    const { app, cookie } = await invited();
    const aiko = sheet('Aiko');
    const ren = sheet('Ren');
    const mei = sheet('Mei', { feelings: { [ren.id]: 'Suspicious' } });
    const made = await send(app, 'POST', '/v1/books', cookie, setup({ protagonist: aiko, cast: [ren, mei] }));
    const path = `/v1/books/${made.body.id}/setup`;

    const sora = sheet('Sora');
    const changed = setup({
      title: 'The Lantern Road, again',
      length: 'novel',
      pov: 'first',
      darkness: 'gentle',
      protagonist: aiko,
      cast: [sora, { ...ren, who: 'A ferryman' }],
    });
    const saved = await send(app, 'PUT', path, cookie, changed);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ title: 'The Lantern Road, again', length: 'novel', wordGoal: 80000 });
    expect(saved.body.updatedAt).toBeGreaterThanOrEqual(made.body.updatedAt);

    const read = await call(app, 'GET', path, cookie);
    expect(read.body).toEqual(changed);
  });

  it('lets the protagonist change places with someone in the cast', async () => {
    const { app, cookie } = await invited();
    const aiko = sheet('Aiko');
    const ren = sheet('Ren');
    const made = await send(app, 'POST', '/v1/books', cookie, setup({ protagonist: aiko, cast: [ren] }));
    const path = `/v1/books/${made.body.id}/setup`;

    const swapped = setup({ protagonist: ren, cast: [aiko] });
    const saved = await send(app, 'PUT', path, cookie, swapped);
    expect(saved.status).toBe(200);

    const read = await call(app, 'GET', path, cookie);
    expect(read.body.protagonist.name).toBe('Ren');
    expect(read.body.cast.map((c: Character) => c.name)).toEqual(['Aiko']);
  });

  it('can’t see or change another account’s book, or one that doesn’t exist', async () => {
    const mine = address('mine');
    const theirs = address('theirs');
    const app = writer({ WRITER_EMAILS: [mine, theirs] });
    const myCookie = await account(mine, true);
    const theirCookie = await account(theirs, true);
    const made = await send(app, 'POST', '/v1/books', theirCookie, setup());
    const path = `/v1/books/${made.body.id}/setup`;

    const peek = await call(app, 'GET', path, myCookie);
    expect(peek.status).toBe(404);
    const change = await send(app, 'PUT', path, myCookie, setup({ title: 'Mine now' }));
    expect(change.status).toBe(404);

    const missing = await call(app, 'GET', `/v1/books/${randomUUID()}/setup`, myCookie);
    expect(missing.status).toBe(404);
    const nonsense = await call(app, 'GET', '/v1/books/not-an-id/setup', myCookie);
    expect(nonsense.status).toBe(404);

    const theirsStill = await call(app, 'GET', path, theirCookie);
    expect(theirsStill.body.title).toBe('The Lantern Road');
  });
});
