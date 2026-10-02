// Tests run against the writer's own Postgres (npm run db), in a database of their own.
export const testEnv: Record<string, string> = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://postgres:postgres@localhost:54329/writer_test',
  SESSION_SECRET: 'test-session-secret-0123456789abcdef0123456789',
  COOKIE_SECURE: 'false',
  ALLOWED_ORIGINS: 'http://localhost:5174',
};
