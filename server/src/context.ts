import type pg from 'pg';
import type { Catalog } from './ai/catalog.ts';
import type { BreaderDb, Db } from './db/client.ts';
import type { Env } from './env.ts';
import type { Login } from './lib/login.ts';

export interface Deps {
  env: Env;
  /** The writer's own tables. */
  db: Db;
  pool: pg.Pool;
  /** Breader's logins, read only (lib/login.ts). The same database as db in production. */
  breader: BreaderDb;
  /** The models the shared proxy serves, or null where there's no proxy and the AI is offline. */
  catalog: Catalog | null;
}

export type AppEnv = {
  Variables: {
    /** The account writing, set by requireWriter (routes/me.ts). */
    login: Login;
  };
};
