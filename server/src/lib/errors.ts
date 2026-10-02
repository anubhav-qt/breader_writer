import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { log } from '../log.ts';

/** An error the person can act on. The app shows the message as written. */
export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function onError(err: Error, c: Context) {
  if (err instanceof ApiError) {
    return c.json({ code: err.code, message: err.message }, err.status);
  }
  log.error({ err, path: c.req.path, method: c.req.method }, 'request failed');
  return c.json({ code: 'server_error', message: 'Something went wrong on the server. Try again in a moment.' }, 500);
}
