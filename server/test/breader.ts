import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type pg from 'pg';
import { testEnv } from './env.ts';

/*
 * A stand-in for breader's server: Better Auth set up the way breader's server/src/auth.ts sets
 * it up (same secret, base path, cookie prefix and session lengths), on breader's login tables
 * (breader.sql). Tests log in through it and hand its cookie to the writer.
 */

const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: at('created_at').notNull().defaultNow(),
  updatedAt: at('updated_at').notNull().defaultNow(),
});

const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: at('access_token_expires_at'),
  refreshTokenExpiresAt: at('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: at('created_at').notNull().defaultNow(),
  updatedAt: at('updated_at').notNull().defaultNow(),
});

const authSessions = pgTable('auth_sessions', {
  id: text('id').primaryKey(),
  expiresAt: at('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: at('created_at').notNull().defaultNow(),
  updatedAt: at('updated_at').notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull(),
});

const verifications = pgTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: at('expires_at').notNull(),
  createdAt: at('created_at').notNull().defaultNow(),
  updatedAt: at('updated_at').notNull().defaultNow(),
});

const DAY = 86_400;

export function makeBreader(pool: pg.Pool, opts: { secure: boolean }) {
  return betterAuth({
    appName: 'Breader',
    baseURL: 'http://localhost:8787',
    basePath: '/v1/auth',
    secret: testEnv.SESSION_SECRET,
    database: drizzleAdapter(drizzle(pool), {
      provider: 'pg',
      schema: { user: users, account: accounts, session: authSessions, verification: verifications },
    }),
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
    session: { expiresIn: 90 * DAY, updateAge: DAY },
    rateLimit: { enabled: false },
    advanced: { cookiePrefix: 'brdr', useSecureCookies: opts.secure },
    telemetry: { enabled: false },
  });
}

export type Breader = ReturnType<typeof makeBreader>;

/** Signs up on the stand-in breader. Returns the Cookie header a browser would then send. */
export async function signUp(breader: Breader, email: string): Promise<string> {
  const res = await breader.api.signUpEmail({
    body: { email, password: 'correct horse battery', name: email.split('@')[0] },
    asResponse: true,
  });
  if (!res.ok) {
    throw new Error(`sign up failed: ${res.status} ${await res.text()}`);
  }
  const pairs = res.headers.getSetCookie().map((line) => line.split(';')[0]);
  return pairs.join('; ');
}
