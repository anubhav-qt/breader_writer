import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { makePool } from './db/client.ts';
import { log } from './log.ts';

/*
 * Brings the writer's schema to the latest version. Its migrations are recorded in their own
 * table, writer.migrations, apart from breader's (drizzle.__drizzle_migrations), so the two
 * projects can share one database without stepping on each other. Like breader's, migrations
 * only ever expand (new tables, nullable columns); removals ship later as their own step.
 */

export const MIGRATIONS = {
  folder: resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle'),
  schema: 'writer',
  table: 'migrations',
};

// Two servers may migrate at once after a release: the second waits here, then finds nothing to do.
const LOCK = "hashtext('writer:migrate')";

export async function runMigrations(url: string, ssl: boolean) {
  const pool = makePool(url, { ssl, name: 'migrate', max: 2 });
  // Session locks need a session: use Supabase's session pooler, not its transaction pooler (6543).
  const lock = await pool.connect();
  try {
    await lock.query(`SELECT pg_advisory_lock(${LOCK})`);
    await migrate(drizzle(pool), {
      migrationsFolder: MIGRATIONS.folder,
      migrationsSchema: MIGRATIONS.schema,
      migrationsTable: MIGRATIONS.table,
    });
    await lock.query(`SELECT pg_advisory_unlock(${LOCK})`);
  } finally {
    lock.release();
    await pool.end();
  }
}

const runDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (runDirectly) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required');
  }
  await runMigrations(url, process.env.DATABASE_SSL === 'require');
  log.info('writer schema migrated');
}
