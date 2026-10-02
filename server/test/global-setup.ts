import { readFileSync } from 'node:fs';
import pg from 'pg';
import { runMigrations } from '../src/migrate.ts';
import { testEnv } from './env.ts';

/** A fresh test database: breader's login tables as breader makes them, then the writer's schema. */
export default async function setup() {
  const url = testEnv.DATABASE_URL;
  const admin = new pg.Client({ connectionString: url.replace(/\/writer_test$/, '/postgres') });
  try {
    await admin.connect();
  } catch (err) {
    throw new Error(`Can't reach the writer's Postgres. Start it first: npm run db\n${String(err)}`);
  }
  await admin.query('DROP DATABASE IF EXISTS writer_test WITH (FORCE)');
  await admin.query('CREATE DATABASE writer_test');
  await admin.end();

  const db = new pg.Client({ connectionString: url });
  await db.connect();
  await db.query(readFileSync(new URL('./breader.sql', import.meta.url), 'utf8'));
  await db.end();

  await runMigrations(url, false);
}
