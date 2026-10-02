import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { authSessions, users } from '../src/db/breader.ts';
import { cookieName, tokenFrom } from '../src/lib/login.ts';
import { makeBreader, signUp } from './breader.ts';
import { account, address, call, deps, env, pool, writer } from './helpers.ts';

const SECRET = env.SESSION_SECRET;

function signed(token: string, secret = SECRET) {
  const signature = createHmac('sha256', secret).update(token).digest('base64');
  return `${token}.${signature}`;
}

describe('the signed cookie', () => {
  it('is named the way Better Auth names it', () => {
    expect(cookieName(false)).toBe('brdr.session_token');
    expect(cookieName(true)).toBe('__Secure-brdr.session_token');
  });

  it('gives its token when the signature is right', () => {
    expect(tokenFrom(signed('abc123'), SECRET)).toBe('abc123');
  });

  it('gives nothing for a wrong secret, a changed token, or no signature', () => {
    expect(tokenFrom(signed('abc123', 'another-secret-0123456789abcdef0123456789'), SECRET)).toBeNull();
    const changed = signed('abc123').replace('abc123', 'abc124');
    expect(tokenFrom(changed, SECRET)).toBeNull();
    expect(tokenFrom('abc123', SECRET)).toBeNull();
    expect(tokenFrom('', SECRET)).toBeNull();
    expect(tokenFrom(undefined, SECRET)).toBeNull();
  });
});

describe('a breader login', () => {
  it('is read by the writer', async () => {
    const email = address('reader');
    const cookie = await account(email, true);
    const r = await call(writer(), 'GET', '/v1/me', cookie);
    expect(r.status).toBe(200);
    expect(r.body.account).toEqual({ email, name: email.split('@')[0], emailVerified: true });
  });

  it('is read with secure cookies, as on breader.site', async () => {
    const secureBreader = makeBreader(pool, { secure: true });
    const email = address('secure');
    const cookie = await signUp(secureBreader, email);
    expect(cookie).toContain('__Secure-brdr.session_token=');

    const secure = await call(writer({ COOKIE_SECURE: true }), 'GET', '/v1/me', cookie);
    expect(secure.body.account.email).toBe(email);
    // A writer expecting plain cookies looks for the other name and finds no one.
    const plain = await call(writer({ COOKIE_SECURE: false }), 'GET', '/v1/me', cookie);
    expect(plain.body.account).toBeNull();
  });

  it('ends when its session expires', async () => {
    const email = address('expired');
    const cookie = await account(email, true);
    const [user] = await deps.breader.select().from(users).where(eq(users.email, email));
    await deps.breader.update(authSessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(authSessions.userId, user.id));
    const r = await call(writer(), 'GET', '/v1/me', cookie);
    expect(r.body).toEqual({ account: null, access: 'logged_out' });
  });

  it('is never written to by the writer', async () => {
    const email = address('untouched');
    const cookie = await account(email, true);
    const before = await pool.query('select * from auth_sessions order by id');
    await call(writer(), 'GET', '/v1/me', cookie);
    await call(writer(), 'GET', '/v1/me', 'brdr.session_token=forged.c2lnbmF0dXJl');
    const after = await pool.query('select * from auth_sessions order by id');
    expect(after.rows).toEqual(before.rows);
  });
});
