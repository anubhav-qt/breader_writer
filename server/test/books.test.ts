import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { users } from '../src/db/breader.ts';
import { books } from '../src/db/schema.ts';
import { account, address, call, deps, writer } from './helpers.ts';

/** A book row's settings, for books put straight into the table. */
const SETTINGS = { length: 'short_story', wordGoal: 8000, pov: 'third_close', darkness: 'mature' };

async function userId(email: string) {
  const [user] = await deps.breader.select().from(users).where(eq(users.email, email));
  return user.id;
}

describe('GET /v1/books', () => {
  it('is closed without a login, to unconfirmed addresses, and to accounts not on the list', async () => {
    const unconfirmed = address('unconfirmed');
    const app = writer({ WRITER_EMAILS: [unconfirmed] });

    const out = await call(app, 'GET', '/v1/books');
    expect(out.status).toBe(401);
    expect(out.body.code).toBe('logged_out');

    const waiting = await call(app, 'GET', '/v1/books', await account(unconfirmed, false));
    expect(waiting.status).toBe(403);
    expect(waiting.body.code).toBe('unconfirmed');

    const stranger = await call(app, 'GET', '/v1/books', await account(address('stranger'), true));
    expect(stranger.status).toBe(403);
    expect(stranger.body.code).toBe('invite_only');
  });

  it('lists only the account’s own books, most recently played first', async () => {
    const mine = address('mine');
    const theirs = address('theirs');
    const app = writer({ WRITER_EMAILS: [mine, theirs] });
    const cookie = await account(mine, true);
    await account(theirs, true);

    const empty = await call(app, 'GET', '/v1/books', cookie);
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ books: [] });

    const me = await userId(mine);
    const them = await userId(theirs);
    const hour = 3_600_000;
    await deps.db.insert(books).values([
      { ...SETTINGS, userId: me, title: 'Older', color: 'teal', wordsWritten: 2000, updatedAt: new Date(Date.now() - 2 * hour) },
      { ...SETTINGS, userId: me, title: 'Newer', color: 'rose', length: 'light_novel', wordGoal: 50000, updatedAt: new Date(Date.now() - hour) },
      { ...SETTINGS, userId: them, title: 'Not yours', color: 'moss' },
    ]);

    const r = await call(app, 'GET', '/v1/books', cookie);
    expect(r.body.books.map((b: { title: string }) => b.title)).toEqual(['Newer', 'Older']);
    const older = r.body.books[1];
    expect(older).toMatchObject({ title: 'Older', color: 'teal', length: 'short_story', wordGoal: 8000, wordsWritten: 2000 });
    expect(typeof older.updatedAt).toBe('number');
  });
});

describe('writes', () => {
  it('only come from the app’s own pages', async () => {
    const r = await call(writer(), 'POST', '/v1/books', '', 'https://elsewhere.example');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('bad_origin');
  });
});
