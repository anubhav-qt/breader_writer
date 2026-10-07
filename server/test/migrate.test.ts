import { describe, expect, it } from 'vitest';
import { runMigrations } from '../src/migrate.ts';
import { env, pool } from './helpers.ts';

async function tables(schema: string) {
  const r = await pool.query<{ table_name: string }>(
    'select table_name from information_schema.tables where table_schema = $1 order by table_name',
    [schema],
  );
  return r.rows.map((row) => row.table_name);
}

describe('the writer schema', () => {
  it('keeps the writer’s tables and migrations to itself', async () => {
    expect(await tables('writer')).toEqual([
      'books',
      'calls',
      'changes',
      'characters',
      'migrations',
      'notes',
      'pages',
      'relationship_history',
      'relationships',
      'scenes',
      'session_messages',
      'session_segments',
      'settings',
      'setup_chat_entries',
      'setup_chat_messages',
      'setup_chats',
      'turns',
      'versions',
      'worlds',
    ]);
    // Only breader's own tables (from test/breader.sql) are in public: the writer added nothing.
    expect(await tables('public')).toEqual(['accounts', 'auth_sessions', 'users', 'verifications']);
    expect(await tables('drizzle')).toEqual([]);
  });

  it('migrates again without doing anything twice', async () => {
    const before = await pool.query('select count(*)::int as n from writer.migrations');
    await runMigrations(env.DATABASE_URL, false);
    const after = await pool.query('select count(*)::int as n from writer.migrations');
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});
