import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/*
 * Breader's own tables that the writer reads to know who is logged in. Breader owns and migrates
 * them (breader's server/src/db/schema.ts); these are only the columns the writer reads, and the
 * writer never writes to them. Kept out of drizzle.config.ts, so drizzle-kit never sees them.
 */

const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** A person with a breader account. */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  emailVerified: boolean('email_verified').notNull(),
});

/** A logged-in browser. Its token is in breader's login cookie (lib/login.ts). */
export const authSessions = pgTable('auth_sessions', {
  id: text('id').primaryKey(),
  token: text('token').notNull(),
  userId: text('user_id').notNull(),
  expiresAt: at('expires_at').notNull(),
});
