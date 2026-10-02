import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Catalog } from '../src/ai/catalog.ts';
import type { Proxy } from '../src/ai/proxy.ts';

/*
 * A stand-in for CLIProxyAPI: the two routes the writer reads, and Gemini's streaming route for a
 * model's reply, answering from what a test hands it and turning away the wrong key the way the
 * proxy does. It keeps what each call was sent, so a test can read the prompt.
 */

export const API_KEY = 'test-api-key';
export const MANAGEMENT_KEY = 'test-management-key';

/** A model's answer: its text, or an error the proxy passes on. */
export interface Reply {
  text?: string;
  /** Gemini's finishReason, STOP unless said. MAX_TOKENS is a reply cut off. */
  finish?: string;
  /** An HTTP error instead of a reply. */
  status?: number;
}

export interface Served {
  /** What /v1/models lists. */
  models: { id: string; owned_by: string }[];
  /** What the management API knows, per account kind. */
  definitions: Record<string, unknown[]>;
  /** What the models answer, in turn. The last one answers every call after it. */
  replies?: Reply[];
}

/** A call to a model: which one, and the request Gemini's API was sent. */
export interface Asked {
  model: string;
  body: GeminiRequest;
}

/** The parts of Gemini's request the tests read. */
export interface GeminiRequest {
  contents: { role: string; parts: { text?: string }[] }[];
  systemInstruction?: { parts: { text?: string }[] };
  generationConfig?: { thinkingConfig?: { thinkingLevel?: string } };
}

export interface FakeProxy {
  url: string;
  served: Served;
  asked: Asked[];
  close: () => Promise<void>;
}

/** The text of a request's system instruction and of its last message. */
export function promptOf(asked: Asked): { system: string; user: string } {
  const system = asked.body.systemInstruction?.parts.map((part) => part.text ?? '').join('') ?? '';
  const last = asked.body.contents.at(-1);
  const user = last?.parts.map((part) => part.text ?? '').join('') ?? '';
  return { system, user };
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

async function bodyOf(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Gemini's streamed reply: one event with all the text, and what it used. */
function streamed(model: string, reply: Reply): string {
  const event = {
    candidates: [{ content: { role: 'model', parts: [{ text: reply.text ?? '' }] }, finishReason: reply.finish ?? 'STOP', index: 0 }],
    usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 80, totalTokenCount: 1280 },
    modelVersion: model,
  };
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** Answers a model call, taking the next reply in line. */
async function reply(served: Served, asked: Asked[], model: string, req: IncomingMessage, res: ServerResponse) {
  const body = JSON.parse(await bodyOf(req)) as GeminiRequest;
  asked.push({ model, body });
  const replies = served.replies ?? [];
  let next: Reply = { text: '' };
  if (replies.length > 1) {
    next = replies.shift() as Reply;
  } else if (replies.length === 1) {
    next = replies[0];
  }
  if (next.status) {
    res.writeHead(next.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: next.status, message: 'The model is busy.', status: 'UNAVAILABLE' } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.end(streamed(model, next));
}

export async function fakeProxy(served: Served): Promise<FakeProxy> {
  const asked: Asked[] = [];
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://proxy').pathname;
    const call = path.match(/^\/v1beta\/models\/([^/:]+):streamGenerateContent$/);
    if (call) {
      if (req.headers['x-goog-api-key'] !== API_KEY) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid API key' }));
        return;
      }
      void reply(served, asked, decodeURIComponent(call[1]), req, res);
      return;
    }
    const { status, body } = answer(served, path, keyOf(req.headers.authorization));
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    served,
    asked,
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
