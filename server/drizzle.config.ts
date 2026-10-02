import { defineConfig } from 'drizzle-kit';

// Only the writer's own schema: breader's tables (src/db/breader.ts) are breader's to migrate.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  schemaFilter: ['writer'],
  migrations: { schema: 'writer', table: 'migrations' },
});
