import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { log } from '../log.ts';
import * as breaderSchema from './breader.ts';
import * as schema from './schema.ts';

export type Db = NodePgDatabase<typeof schema>;
export type BreaderDb = NodePgDatabase<typeof breaderSchema>;

// Postgres bigint comes back as a string by default; every bigint here fits a JS number.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export function makePool(url: string, opts: { ssl: boolean; name: string; max?: number }) {
  let ssl: pg.PoolConfig['ssl'] = undefined;
  if (opts.ssl) {
    // Supabase's pooler presents a certificate for its own domain; the connection is still encrypted.
    ssl = { rejectUnauthorized: false };
  }
  const pool = new pg.Pool({
    connectionString: url,
    max: opts.max ?? 5,
    ssl,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: `writer-${opts.name}`,
  });
  pool.on('error', (err) => log.warn({ err, pool: opts.name }, 'idle database connection failed'));
  return pool;
}

export function writerDb(pool: pg.Pool): Db {
  return drizzle(pool, { schema });
}

export function breaderDb(pool: pg.Pool): BreaderDb {
  return drizzle(pool, { schema: breaderSchema });
}
