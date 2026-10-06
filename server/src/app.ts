import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import type { AppEnv, Deps } from './context.ts';
import { ApiError, onError } from './lib/errors.ts';
import { sameOriginWrites } from './lib/http.ts';
import { log } from './log.ts';
import { accountRoutes } from './routes/accounts.ts';
import { bookRoutes } from './routes/books.ts';
import { healthRoutes } from './routes/health.ts';
import { meRoutes } from './routes/me.ts';
import { settingsRoutes } from './routes/settings.ts';
import { suggestionRoutes } from './routes/suggestions.ts';

export function makeApp(deps: Deps) {
  const allowed = deps.env.ALLOWED_ORIGINS;
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    const start = performance.now();
    await next();
    const ms = Math.round(performance.now() - start);
    let level: 'error' | 'trace' | 'debug' = 'debug';
    if (c.res.status >= 500) {
      level = 'error';
    } else if (c.req.path === '/health') {
      level = 'trace';
    }
    log[level]({ method: c.req.method, path: c.req.path, status: c.res.status, ms }, 'request');
  });
  app.use(
    '*',
    cors({
      origin: (origin) => {
        if (allowed.includes(origin)) {
          return origin;
        }
        return null;
      },
      credentials: true,
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowHeaders: ['content-type'],
      maxAge: 600,
    }),
  );
  app.use('/v1/*', sameOriginWrites(allowed));
  app.use(
    '/v1/*',
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: () => {
        throw new ApiError(413, 'too_large', 'That request is too large.');
      },
    }),
  );

  app.route('/', healthRoutes(deps));
  app.route('/v1', meRoutes(deps));
  app.route('/v1', bookRoutes(deps));
  app.route('/v1', settingsRoutes(deps));
  app.route('/v1', accountRoutes(deps));
  app.route('/v1', suggestionRoutes(deps));

  app.notFound((c) => c.json({ code: 'not_found', message: 'No such endpoint.' }, 404));
  app.onError(onError);
  return app;
}
