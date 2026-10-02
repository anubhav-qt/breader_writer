import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Catalog } from '../src/ai/catalog.ts';
import type { Proxy } from '../src/ai/proxy.ts';

/*
 * A stand-in for CLIProxyAPI: the two routes the writer reads, answering from what a test hands
 * it, and turning away the wrong key the way the proxy does.
 */

export const API_KEY = 'test-api-key';
export const MANAGEMENT_KEY = 'test-management-key';

export interface Served {
  /** What /v1/models lists. */
  models: { id: string; owned_by: string }[];
  /** What the management API knows, per account kind. */
  definitions: Record<string, unknown[]>;
}

export interface FakeProxy {
  url: string;
  served: Served;
  close: () => Promise<void>;
}

function keyOf(header: string | undefined): string {
  if (!header) {
    return '';
  }
  return header.replace(/^Bearer /, '');
}

function answer(served: Served, path: string, key: string): { status: number; body: unknown } {
  if (path === '/v1/models') {
    if (key !== API_KEY) {
      return { status: 401, body: { error: 'Invalid API key' } };
    }
    return { status: 200, body: { object: 'list', data: served.models } };
  }
  const definitions = path.match(/^\/v8\/management\/routing\/model-definitions\/([^/]+)$/);
  if (definitions) {
    if (key !== MANAGEMENT_KEY) {
      return { status: 401, body: { error: 'invalid management key' } };
    }
    const provider = decodeURIComponent(definitions[1]);
    return { status: 200, body: { models: served.definitions[provider] ?? [] } };
  }
  return { status: 404, body: { error: 'not found' } };
}

export async function fakeProxy(served: Served): Promise<FakeProxy> {
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://proxy').pathname;
    const { status, body } = answer(served, path, keyOf(req.headers.authorization));
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    served,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A fresh catalog of the fake proxy's models, with the management key or without. */
export function catalogOf(proxy: { url: string }, managementKey = MANAGEMENT_KEY): Catalog {
  const settings: Proxy = { url: proxy.url, apiKey: API_KEY, managementKey };
  return new Catalog(settings);
}

/** What Antigravity serves, about as the real proxy describes it. */
export function antigravity(): Served {
  return {
    models: [
      { id: 'claude-sonnet-4-6', owned_by: 'antigravity' },
      { id: 'gemini-3.1-flash-image', owned_by: 'antigravity' },
      { id: 'gemini-3.8-flash-high', owned_by: 'antigravity' },
      { id: 'gpt-oss-120b-medium', owned_by: 'antigravity' },
    ],
    definitions: {
      antigravity: [
        {
          id: 'gemini-3.8-flash-high',
          display_name: 'Gemini 3.8 Flash',
          context_length: 1_048_576,
          max_completion_tokens: 65_536,
          supportedInputModalities: ['text', 'image'],
          supportedOutputModalities: ['text'],
          thinking: { levels: ['minimal', 'low', 'medium', 'high'] },
        },
        {
          id: 'claude-sonnet-4-6',
          display_name: 'Claude Sonnet 4.6',
          context_length: 200_000,
          max_completion_tokens: 64_000,
          thinking: { min: 1024, max: 64_000, zero_allowed: true },
        },
        {
          id: 'gemini-3.1-flash-image',
          display_name: 'Gemini 3.1 Flash Image',
          supportedOutputModalities: ['text', 'image'],
        },
      ],
    },
  };
}
