import { Hono } from 'hono';
import type { Me } from '@writer/shared/protocol';
import type { AppEnv, Deps } from '../context.ts';
import { accessFor, isOwner } from '../lib/access.ts';
import { readLogin } from '../lib/login.ts';

export function meRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();

  /** Who is logged in (through breader), whether they can write, and whether they're the owner. Anyone may ask. */
  r.get('/me', async (c) => {
    const login = await readLogin(c, deps.env, deps.breader);
    let account: Me['account'] = null;
    if (login) {
      account = { email: login.email, name: login.name, emailVerified: login.emailVerified };
    }
    const me: Me = {
      account,
      access: accessFor(login, deps.env.WRITER_EMAILS, deps.env.OPEN_TO_ALL),
      owner: isOwner(login, deps.env),
    };
    return c.json(me);
  });

  return r;
}
