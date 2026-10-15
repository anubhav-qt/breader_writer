import type { Context } from 'hono';
import { streamSSE, type SSEStreamingApi } from 'hono/streaming';

/*
 * The routes' server-sent events. In production every answer comes through Cloudflare and its
 * tunnel, which close a connection that's quiet for 100 seconds, and Procreator can think, cue
 * actors or rewrite a part for longer than that before its next words. So a quiet stream says it's
 * still there now and then, with a comment line, which the app's reader skips.
 */

const STILL_HERE_MS = 20_000;

/** Hono's streamSSE, with a comment sent every `everyMs` until `run` is done. */
export function eventStream(c: Context, run: (stream: SSEStreamingApi) => Promise<void>, everyMs = STILL_HERE_MS) {
  return streamSSE(c, async (stream) => {
    const timer = setInterval(() => {
      void stream.write(': still here\n\n');
    }, everyMs);
    try {
      await run(stream);
    } finally {
      clearInterval(timer);
    }
  });
}
