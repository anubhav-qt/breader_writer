import type { MiddlewareHandler } from 'hono';
import type { Access } from '@writer/shared/protocol';
import type { AppEnv, Deps } from '../context.ts';
import type { Env } from '../env.ts';
import { ApiError } from './errors.ts';
import { readLogin, type Login } from './login.ts';

/**
 * Whether an account can write. The accounts in WRITER_EMAILS can, once their address is
 * confirmed, and so can every confirmed account once the writer is open to all (`everyone`). A
 * key session on its own never can, since a key has no email.
 *
 * An unconfirmed address hears that before anything else, so the answer never tells anyone
 * whether an email they don't own is on the list.
 */
export function accessFor(login: Login | null, allowed: string[], everyone = false): Access {
  if (!login) {
    return 'logged_out';
  }
  if (!login.emailVerified) {
    return 'unconfirmed';
  }
  if (everyone) {
    return 'open';
  }
  const email = login.email.toLowerCase();
  if (!allowed.includes(email)) {
    return 'invite_only';
  }
  return 'open';
}

/**
 * Whether an account is invited: a confirmed address in WRITER_EMAILS. The owner's AI writes
 * everything for the invited, and only a first chapter for anyone else (step 9).
 */
export function isInvited(login: Login | null, env: Pick<Env, 'WRITER_EMAILS'>): boolean {
  return accessFor(login, env.WRITER_EMAILS) === 'open';
}

/**
 * Whether an account signs the proxy's AI accounts in and out: a writer whose email is in
 * OWNER_EMAILS. Everyone's stories run on those accounts, so they're the owner's alone.
 */
export function isOwner(login: Login | null, env: Pick<Env, 'WRITER_EMAILS' | 'OWNER_EMAILS'>): boolean {
  if (!login) {
    return false;
  }
  if (!isInvited(login, env)) {
    return false;
  }
  const email = login.email.toLowerCase();
  return env.OWNER_EMAILS.includes(email);
}

const CLOSED: Record<'unconfirmed' | 'invite_only', string> = {
  unconfirmed: 'Confirm your email first, with the link breader sent you.',
  invite_only: 'The writer is invite only for now.',
};

/** Lets a request through only for an account that can write, and hands routes its login. */
export function requireWriter(deps: Deps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const login = await readLogin(c, deps.env, deps.breader);
    if (!login) {
      throw new ApiError(401, 'logged_out', 'Log in with your breader account to write.');
    }
    const access = accessFor(login, deps.env.WRITER_EMAILS, deps.env.OPEN_TO_ALL);
    if (access === 'unconfirmed' || access === 'invite_only') {
      throw new ApiError(403, access, CLOSED[access]);
    }
    c.set('login', login);
    await next();
  };
}

/** Lets a request through only for the owner. Goes after requireWriter, which reads the login. */
export function requireOwner(deps: Deps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!isOwner(c.var.login, deps.env)) {
      throw new ApiError(403, 'not_owner', 'Only the owner signs the AI accounts in and out.');
    }
    await next();
  };
}
