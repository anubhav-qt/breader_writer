import { Hono } from 'hono';
import type { AppEnv, Deps } from '../context.ts';

export function healthRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();

  /** Liveness, with no database call. The app asks this to tell "offline" from an error. */
  r.get('/health', (c) => c.json({ ok: true, release: deps.env.RELEASE }));

  return r;
}
