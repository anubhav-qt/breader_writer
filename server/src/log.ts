import { pino } from 'pino';

/** JSON logs on stdout. Pipe through pino-pretty when reading them by hand. */
export const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { app: 'writer' },
  redact: ['req.headers.cookie'],
});
