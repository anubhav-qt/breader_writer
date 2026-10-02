import type { MiddlewareHandler } from 'hono';
import { ApiError } from './errors.ts';

/**
 * Writes must come from the app's own pages. Browsers always send Origin on these requests, so a
 * missing or foreign Origin means another site (or a script) is trying to use the login cookie.
 * Copied from breader's server/src/lib/http.ts.
 */
export function sameOriginWrites(allowed: string[]): MiddlewareHandler {
  return async (c, next) => {
    const method = c.req.method;
    const reading = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
    if (!reading) {
      const origin = c.req.header('origin');
      if (!origin || !allowed.includes(origin)) {
        throw new ApiError(403, 'bad_origin', 'This request didn’t come from the writer.');
      }
    }
    await next();
  };
}
