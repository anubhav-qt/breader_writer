import { z } from 'zod';
import type { Env } from '../env.ts';

/*
 * The CLIProxyAPI the models come through (see CLAUDE.md), cut down to what the writer reads:
 * the models the signed in accounts serve, and what the proxy knows about each. Accounts are
 * signed in to it outside the writer, for now.
 */

const TIMEOUT_MS = 15_000;

export interface Proxy {
  /** Its address, without a trailing slash. */
  url: string;
  /** For the model endpoints. */
  apiKey: string;
  /** For the management API. Blank means the models come without their details. */
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
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ProxyError';
    this.status = status;
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

async function reach(url: URL, key: string): Promise<Response> {
  try {
    return await fetch(url, {
      headers: { authorization: `Bearer ${key}` },
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

async function get<T extends z.ZodType>(proxy: Proxy, path: string, key: string, shape: T): Promise<z.infer<T>> {
  const res = await reach(new URL(proxy.url + path), key);
  const text = await res.text();
  if (!res.ok) {
    throw new ProxyError(`CLIProxyAPI ${res.status}: ${text.slice(0, 200)}`, res.status);
  }
  const parsed = shape.safeParse(jsonOrNull(text));
  if (!parsed.success) {
    throw new ProxyError(`CLIProxyAPI answered ${path} in a shape the writer doesn't know.`, res.status);
  }
  return parsed.data;
}

/** The models the signed in accounts can serve right now. */
export async function listModels(proxy: Proxy): Promise<Listed[]> {
  const body = await get(proxy, '/v1/models', proxy.apiKey, ListedModels);
  return body.data;
}

/** What the proxy knows about the models of one account kind (antigravity, codex, claude). */
export async function modelDefinitions(proxy: Proxy, provider: string): Promise<ModelDefinition[]> {
  const path = `/v8/management/routing/model-definitions/${encodeURIComponent(provider)}`;
  const body = await get(proxy, path, proxy.managementKey, ModelDefinitions);
  return body.models;
}
