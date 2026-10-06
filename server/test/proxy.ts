import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Catalog } from '../src/ai/catalog.ts';
import type { Proxy } from '../src/ai/proxy.ts';

/*
 * A stand-in for CLIProxyAPI: the models it lists and what it knows about them, Gemini's
 * streaming route for a model's reply, and the management routes the owner's accounts go
 * through. It answers from what a test hands it (text, tool calls, a thought signature, what it
 * read and what of that came from the cache; the accounts signed in) and turns away the wrong
 * key the way the proxy does. It keeps what each call was sent, so a test can read the prompt,
 * and the sign-ins started, so a test can see them through.
 */

export const API_KEY = 'test-api-key';
export const MANAGEMENT_KEY = 'test-management-key';

/** A tool call in a model's answer. */
export interface Call {
  name: string;
  args: Record<string, unknown>;
}

/** A model's answer: its text and tool calls, or an error the proxy passes on. */
export interface Reply {
  text?: string;
  /** Tool calls, before any text. */
  calls?: Call[];
  /** A thought signature on the answer's first part, as Gemini 3 sends them. */
  signature?: string;
  /** Gemini's finishReason, STOP unless said. MAX_TOKENS is a reply cut off. */
  finish?: string;
  /** An HTTP error instead of a reply. */
  status?: number;
  /** The tokens it says it read, 1200 unless said. */
  read?: number;
  /** Of those, the ones it says came from the cache. */
  cached?: number;
}

/** An account signed in to the proxy, as its management API lists it. */
export interface Credential {
  name: string;
  provider: string;
  email?: string;
  label?: string;
  status?: string;
  status_message?: string;
  disabled?: boolean;
  unavailable?: boolean;
}

/** A sign-in the proxy has started, and how it stands. A test moves it along. */
export interface PendingSignIn {
  provider: string;
  /** Whether it was asked to listen for the callback on its own machine. */
  webui: boolean;
  status: 'wait' | 'ok' | 'error';
  error?: string;
  /** What the callback route was handed, once it was. */
  callback?: Record<string, unknown>;
}

export interface Served {
  /** What /v1/models lists. */
  models: { id: string; owned_by: string }[];
  /** What the management API knows, per account kind. */
  definitions: Record<string, unknown[]>;
  /** What the models answer, in turn. The last one answers every call after it. */
  replies?: Reply[];
  /** The accounts signed in. */
  credentials?: Credential[];
}

/** A call to a model: which one, and the request Gemini's API was sent. */
export interface Asked {
  model: string;
  body: GeminiRequest;
}

/** A part of a message in Gemini's request. */
export interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

/** The parts of Gemini's request the tests read. */
export interface GeminiRequest {
  contents: { role: string; parts: GeminiPart[] }[];
  systemInstruction?: { parts: { text?: string }[] };
  tools?: { functionDeclarations: { name: string }[] }[];
  generationConfig?: { thinkingConfig?: { thinkingLevel?: string } };
}

export interface FakeProxy {
  url: string;
  served: Served;
  asked: Asked[];
  /** The sign-ins started, by state. */
  signIns: Map<string, PendingSignIn>;
  close: () => Promise<void>;
}

/** The text of a request's system instruction and of its last message. */
export function promptOf(asked: Asked): { system: string; user: string } {
  const system = asked.body.systemInstruction?.parts.map((part) => part.text ?? '').join('') ?? '';
  const last = asked.body.contents.at(-1);
  const user = last?.parts.map((part) => part.text ?? '').join('') ?? '';
  return { system, user };
}

/** Every message's text in a request, in order: what the model was sent, besides its instructions. */
export function textsOf(asked: Asked): string[] {
  const texts: string[] = [];
  for (const content of asked.body.contents) {
    for (const part of content.parts) {
      if (part.text) {
        texts.push(part.text);
      }
    }
  }
  return texts;
}

/** The tools a request declared, by name. */
export function toolsOf(asked: Asked): string[] {
  const names: string[] = [];
  for (const tool of asked.body.tools ?? []) {
    for (const declaration of tool.functionDeclarations) {
      names.push(declaration.name);
    }
  }
  return names;
}

function keyOf(header: string | undefined): string {
  if (!header) {
    return '';
  }
  return header.replace(/^Bearer /, '');
}

interface Answer {
  status: number;
  body: unknown;
}

const MANAGEMENT = '/v8/management';

/** Starts a sign-in, the way the proxy hands out its provider's sign-in page. */
function startSignIn(signIns: Map<string, PendingSignIn>, url: URL): Answer {
  const provider = url.searchParams.get('provider') ?? '';
  const state = `state-${signIns.size + 1}`;
  const webui = url.searchParams.get('is_webui') === 'true';
  signIns.set(state, { provider, webui, status: 'wait' });
  const page = `https://sign-in.example/${provider}?state=${state}`;
  return { status: 200, body: { status: 'ok', url: page, state } };
}

function signInStatus(signIns: Map<string, PendingSignIn>, url: URL): Answer {
  const signIn = signIns.get(url.searchParams.get('state') ?? '');
  if (!signIn) {
    return { status: 200, body: { status: 'error', error: 'unknown or expired state' } };
  }
  if (signIn.status === 'error') {
    return { status: 200, body: { status: 'error', error: signIn.error } };
  }
  return { status: 200, body: { status: signIn.status } };
}

function takeCallback(signIns: Map<string, PendingSignIn>, sent: Record<string, unknown>): Answer {
  const signIn = signIns.get(String(sent.state ?? ''));
  if (!signIn) {
    return { status: 404, body: { status: 'error', error: 'unknown or expired state' } };
  }
  signIn.callback = sent;
  return { status: 200, body: { status: 'ok' } };
}

/** Signs an account out. Once no account of its kind is left, that kind's models go too. */
function signOut(served: Served, url: URL): Answer {
  const name = url.searchParams.get('name') ?? '';
  const before = served.credentials ?? [];
  const leaving = before.find((credential) => credential.name === name);
  if (!leaving) {
    return { status: 404, body: { error: 'file not found' } };
  }
  const after = before.filter((credential) => credential !== leaving);
  served.credentials = after;
  const kindLeft = after.some((credential) => credential.provider === leaving.provider);
  if (!kindLeft) {
    served.models = served.models.filter((model) => model.owned_by !== leaving.provider);
  }
  return { status: 200, body: { status: 'ok' } };
}

/** The management routes the writer uses. The callback takes no key, as the proxy's doesn't. */
async function manage(proxy: FakeProxy, req: IncomingMessage, url: URL, key: string): Promise<Answer> {
  const path = url.pathname.slice(MANAGEMENT.length);
  const method = req.method ?? 'GET';
  if (path === '/oauth/callback' && method === 'POST') {
    const sent = JSON.parse(await bodyOf(req)) as Record<string, unknown>;
    return takeCallback(proxy.signIns, sent);
  }
  if (key !== MANAGEMENT_KEY) {
    return { status: 401, body: { error: 'invalid management key' } };
  }
  const definitions = path.match(/^\/routing\/model-definitions\/([^/]+)$/);
  if (definitions) {
    const provider = decodeURIComponent(definitions[1]);
    return { status: 200, body: { models: proxy.served.definitions[provider] ?? [] } };
  }
  if (path === '/credentials' && method === 'GET') {
    return { status: 200, body: { files: proxy.served.credentials ?? [] } };
  }
  if (path === '/credentials' && method === 'DELETE') {
    return signOut(proxy.served, url);
  }
  if (path === '/oauth/auth-url' && method === 'GET') {
    return startSignIn(proxy.signIns, url);
  }
  if (path === '/oauth/status' && method === 'GET') {
    return signInStatus(proxy.signIns, url);
  }
  if (path === '/oauth/session' && method === 'DELETE') {
    const cancelled = proxy.signIns.delete(url.searchParams.get('state') ?? '');
    return { status: 200, body: { status: 'ok', cancelled } };
  }
  return { status: 404, body: { error: 'not found' } };
}

async function answer(proxy: FakeProxy, req: IncomingMessage, url: URL): Promise<Answer> {
  const key = keyOf(req.headers.authorization);
  if (url.pathname === '/v1/models') {
    if (key !== API_KEY) {
      return { status: 401, body: { error: 'Invalid API key' } };
    }
    return { status: 200, body: { object: 'list', data: proxy.served.models } };
  }
  if (url.pathname.startsWith(MANAGEMENT + '/')) {
    return manage(proxy, req, url, key);
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

/** The parts of a reply: its tool calls, then its text. */
function partsOf(reply: Reply): GeminiPart[] {
  const parts: GeminiPart[] = [];
  for (const call of reply.calls ?? []) {
    parts.push({ functionCall: { name: call.name, args: call.args } });
  }
  if (reply.text !== undefined || parts.length === 0) {
    parts.push({ text: reply.text ?? '' });
  }
  if (reply.signature) {
    parts[0].thoughtSignature = reply.signature;
  }
  return parts;
}

/** Gemini's streamed reply: one event with all of it, and what it used. */
function streamed(model: string, reply: Reply): string {
  const read = reply.read ?? 1200;
  const event = {
    candidates: [{ content: { role: 'model', parts: partsOf(reply) }, finishReason: reply.finish ?? 'STOP', index: 0 }],
    usageMetadata: {
      promptTokenCount: read,
      cachedContentTokenCount: reply.cached ?? 0,
      candidatesTokenCount: 80,
      totalTokenCount: read + 80,
    },
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
  // Its address and close are filled in once it listens.
  const proxy: FakeProxy = { url: '', served, asked: [], signIns: new Map(), close: async () => {} };
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://proxy');
    const call = url.pathname.match(/^\/v1beta\/models\/([^/:]+):streamGenerateContent$/);
    if (call) {
      if (req.headers['x-goog-api-key'] !== API_KEY) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid API key' }));
        return;
      }
      void reply(served, proxy.asked, decodeURIComponent(call[1]), req, res);
      return;
    }
    void answer(proxy, req, url).then(({ status, body }) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  proxy.url = `http://127.0.0.1:${port}`;
  proxy.close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return proxy;
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
