import { z } from 'zod';
import type { Env } from '../env.ts';

/*
 * The CLIProxyAPI the models come through (see CLAUDE.md), cut down to what the writer uses: the
 * models the signed in accounts serve, what the proxy knows about each, and (in accounts.ts) the
 * accounts the owner signs in and out through its management API.
 */

const TIMEOUT_MS = 15_000;
/** The management API's newer routes. The older /v0/management ones are on their way out. */
const MANAGEMENT = '/v8/management';

export interface Proxy {
  /** Its address, without a trailing slash. */
  url: string;
  /** For the model endpoints. */
  apiKey: string;
  /** For the management API. Blank means the models come without their details, and no accounts can be managed. */
  managementKey: string;
}

/** The proxy the settings name, or null when there's none here, and the AI is offline. */
export function proxyFrom(env: Env): Proxy | null {
  const url = env.CLIPROXY_URL?.trim().replace(/\/+$/, '');
  if (!url) {
    return null;
  }
  return { url, apiKey: env.CLIPROXY_API_KEY.trim(), managementKey: env.CLIPROXY_MANAGEMENT_KEY.trim() };
}

/** The proxy couldn't be reached, or turned the request away. */
export class ProxyError extends Error {
  /** Its HTTP status, or 0 when it couldn't be reached at all. */
  readonly status: number;
  /** Why it said no, in its own words, when it said. */
  readonly reason: string | null;
  constructor(message: string, status: number, reason: string | null = null) {
    super(message);
    this.name = 'ProxyError';
    this.status = status;
    this.reason = reason;
  }
}

/** A model as the proxy lists it: its id, and the account kind serving it. */
const Listed = z.object({
  id: z.string(),
  owned_by: z.string().default(''),
});
export type Listed = z.infer<typeof Listed>;

const ListedModels = z.object({
  data: z.array(Listed).default([]),
});

/** What the proxy knows about a model, per account kind. */
const ModelDefinition = z.object({
  id: z.string(),
  display_name: z.string().optional(),
  context_length: z.number().int().optional(),
  max_completion_tokens: z.number().int().optional(),
  supportedInputModalities: z.array(z.string()).optional(),
  supportedOutputModalities: z.array(z.string()).optional(),
  thinking: z
    .object({
      levels: z.array(z.string()).optional(),
      zero_allowed: z.boolean().optional(),
    })
    .optional(),
});
export type ModelDefinition = z.infer<typeof ModelDefinition>;

const ModelDefinitions = z.object({
  models: z.array(ModelDefinition).default([]),
});

/** A request to the proxy: its method, and a JSON body or none. */
export interface Sent {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
}

const GET: Sent = { method: 'GET' };

async function reach(url: URL, key: string, sent: Sent): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Bearer ${key}` };
  let body: string | undefined;
  if (sent.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(sent.body);
  }
  try {
    return await fetch(url, {
      method: sent.method,
      headers,
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    let why = String(err);
    if (err instanceof Error) {
      why = err.message;
    }
    throw new ProxyError(`CLIProxyAPI can't be reached (${why}).`, 0);
  }
}

function jsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The proxy's own words for why it said no: the `error` its answers carry. */
const Refusal = z.object({ error: z.string() });

function reasonIn(text: string): string | null {
  const refusal = Refusal.safeParse(jsonOrNull(text));
  if (!refusal.success) {
    return null;
  }
  return refusal.data.error;
}

async function ask<T extends z.ZodType>(proxy: Proxy, path: string, key: string, shape: T, sent: Sent): Promise<z.infer<T>> {
  const res = await reach(new URL(proxy.url + path), key, sent);
  const text = await res.text();
  if (!res.ok) {
    throw new ProxyError(`CLIProxyAPI ${res.status}: ${text.slice(0, 200)}`, res.status, reasonIn(text));
  }
  const parsed = shape.safeParse(jsonOrNull(text));
  if (!parsed.success) {
    throw new ProxyError(`CLIProxyAPI answered ${path} in a shape the writer doesn't know.`, res.status);
  }
  return parsed.data;
}

/** A call to the management API (a path under /v8/management), with its key. */
export async function manage<T extends z.ZodType>(proxy: Proxy, path: string, shape: T, sent: Sent = GET): Promise<z.infer<T>> {
  return ask(proxy, MANAGEMENT + path, proxy.managementKey, shape, sent);
}

/** The models the signed in accounts can serve right now. */
export async function listModels(proxy: Proxy): Promise<Listed[]> {
  const body = await ask(proxy, '/v1/models', proxy.apiKey, ListedModels, GET);
  return body.data;
}

/** What the proxy knows about the models of one account kind (antigravity, codex, claude). */
export async function modelDefinitions(proxy: Proxy, provider: string): Promise<ModelDefinition[]> {
  const path = `/routing/model-definitions/${encodeURIComponent(provider)}`;
  const body = await manage(proxy, path, ModelDefinitions);
  return body.models;
}
