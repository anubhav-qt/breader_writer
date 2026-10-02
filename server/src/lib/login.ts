import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { authSessions, users } from '../db/breader.ts';
import type { BreaderDb } from '../db/client.ts';
import type { Env } from '../env.ts';

/*
 * Who is logged in, read from breader's own login.
 *
 * Breader runs Better Auth (breader's server/src/auth.ts). Its login cookie is set on the parent
 * domain, so the writer receives it too. The cookie holds a session token and the token's
 * signature: HMAC-SHA256 with breader's SESSION_SECRET, in base64. The writer checks the signature
 * with the same secret, then looks the token up in breader's tables.
 *
 * The writer only ever reads. Logging in and out, refreshing sessions and clearing old ones stay
 * breader's job. test/login.test.ts signs in with a real Better Auth, so a change to its cookie
 * fails a test here instead of logging everyone out.
 */

const COOKIE = 'brdr.session_token';

export interface Login {
  /** Breader's user id, which owns the account's books. */
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

/** Better Auth puts __Secure- in front of its cookies' names when they're secure, as on breader.site. */
export function cookieName(secure: boolean): string {
  if (secure) {
    return `__Secure-${COOKIE}`;
  }
  return COOKIE;
}

function signature(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('base64');
}

/** The session token in a signed cookie value, or null when its signature isn't right. */
export function tokenFrom(value: string | undefined, secret: string): string | null {
  if (!value) {
    return null;
  }
  const dot = value.lastIndexOf('.');
  if (dot < 1) {
    return null;
  }
  const token = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(signature(token, secret));
  if (given.length !== expected.length) {
    return null;
  }
  if (!timingSafeEqual(given, expected)) {
    return null;
  }
  return token;
}

/** The account logged in on this request, or null. An expired session counts as logged out. */
export async function readLogin(c: Context, env: Env, db: BreaderDb): Promise<Login | null> {
  const value = getCookie(c, cookieName(env.COOKIE_SECURE));
  const token = tokenFrom(value, env.SESSION_SECRET);
  if (!token) {
    return null;
  }
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name, emailVerified: users.emailVerified })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .where(and(eq(authSessions.token, token), gt(authSessions.expiresAt, new Date())))
    .limit(1);
  if (rows.length === 0) {
    return null;
  }
  return rows[0];
}
