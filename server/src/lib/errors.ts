import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';
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

/** Validates a request body, turning zod's first issue into one readable 400. Copied from breader. */
export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }
  const first = result.error.issues[0];
  let where = '';
  if (first && first.path.length > 0) {
    where = ` (${first.path.join('.')})`;
  }
  let message = 'That request isn’t one the writer understands.';
  if (first) {
    message = first.message;
  }
  throw new ApiError(400, 'bad_request', `${message}${where}`);
}

export async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ApiError(400, 'bad_json', 'The request body isn’t valid JSON.');
  }
}

export function onError(err: Error, c: Context) {
  if (err instanceof ApiError) {
    return c.json({ code: err.code, message: err.message }, err.status);
  }
  log.error({ err, path: c.req.path, method: c.req.method }, 'request failed');
  return c.json({ code: 'server_error', message: 'Something went wrong on the server. Try again in a moment.' }, 500);
}
