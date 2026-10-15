import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { eventStream } from '../src/lib/sse.ts';

/** A route that thinks for `quietMs` before its one event, saying it's still there every 10ms. */
function quietRoute(quietMs: number) {
  const app = new Hono();
  app.get('/stream', (c) =>
    eventStream(
      c,
      async (stream) => {
        await new Promise((done) => setTimeout(done, quietMs));
        await stream.writeSSE({ data: JSON.stringify({ type: 'done' }) });
      },
      10,
    ),
  );
  return app;
}

describe('server-sent events', () => {
  it('say they are still there while the work is quiet, then stop', async () => {
    const res = await quietRoute(60).request('/stream');
    const body = await res.text();
    const parts = body.split('\n\n').filter((part) => part !== '');
    const comments = parts.filter((part) => part === ': still here');
    expect(comments.length).toBeGreaterThanOrEqual(3);
    expect(parts[parts.length - 1]).toBe('data: {"type":"done"}');
  });

  it('send nothing extra when the work is quick', async () => {
    const res = await quietRoute(0).request('/stream');
    expect(await res.text()).toBe('data: {"type":"done"}\n\n');
  });
});
