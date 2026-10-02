import type { MiddlewareHandler } from 'hono';
import type { Access } from '@writer/shared/protocol';
import type { AppEnv, Deps } from '../context.ts';
import { ApiError } from './errors.ts';
import { readLogin, type Login } from './login.ts';

/**
 * Whether an account can write. Only the accounts in WRITER_EMAILS can, once their address is
 * confirmed: the AI runs on the owner's own subscriptions, so it stays personal and inside their
 * limits. A key session on its own never can, since a key has no email.
 *
 * An unconfirmed address hears that before anything else, so the answer never tells anyone
 * whether an email they don't own is on the list.
 */
export function accessFor(login: Login | null, allowed: string[]): Access {
  if (!login) {
    return 'logged_out';
  }
  if (!login.emailVerified) {
    return 'unconfirmed';
  }
  const email = login.email.toLowerCase();
  if (!allowed.includes(email)) {
    return 'invite_only';
  }
  return 'open';
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
    const access = accessFor(login, deps.env.WRITER_EMAILS);
    if (access === 'unconfirmed' || access === 'invite_only') {
      throw new ApiError(403, access, CLOSED[access]);
    }
    c.set('login', login);
    await next();
  };
}
