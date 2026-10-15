import { z } from 'zod';
import type { Api, Model, ThinkingLevelMap } from '@writer/pi-ai';
import type { KeyProvider } from '@writer/shared/protocol';

/*
 * The providers a writer brings their own API key for (step 9): Google's Gemini API, Anthropic's
 * and OpenAI's, called directly, without a proxy. A key is checked by listing the models it
 * reaches, and those are the models it adds to the picker.
 */

const TIMEOUT_MS = 15_000;

/** Where each provider is reached. Tests point them at a stand-in. */
export type ProviderUrls = Record<KeyProvider, string>;

export const PROVIDER_URLS: ProviderUrls = {
  google: 'https://generativelanguage.googleapis.com/v1beta',
  // The Anthropic SDK adds /v1/messages itself.
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
};

export const PROVIDER_NAMES: Record<KeyProvider, string> = {
  google: 'Google',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
};

/** The provider turned the key away, or couldn't be reached. */
export class KeyError extends Error {
  /** Whether the provider said no to the key itself, rather than not answering. */
  readonly refused: boolean;
  constructor(message: string, refused: boolean) {
    super(message);
    this.name = 'KeyError';
    this.refused = refused;
  }
}

const CONTEXT_WINDOW = 128_000;
const MAX_TOKENS = 32_000;

/** A model as a provider lists it, made the same shape for all three. */
interface Listed {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
}

async function fetchList(provider: KeyProvider, url: string, headers: Record<string, string>): Promise<unknown> {
  const name = PROVIDER_NAMES[provider];
  let res: Response;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new KeyError(`${name} can’t be reached right now.`, false);
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    throw new KeyError(`${name} turned that key away.`, true);
  }
  if (!res.ok) {
    throw new KeyError(`${name} answered ${res.status}. Try again in a moment.`, false);
  }
  return res.json();
}

const GoogleModels = z.object({
  models: z
    .array(
      z.object({
        name: z.string(),
        displayName: z.string().optional(),
        inputTokenLimit: z.number().int().optional(),
        outputTokenLimit: z.number().int().optional(),
        supportedGenerationMethods: z.array(z.string()).default([]),
      }),
    )
    .default([]),
});

/** Gemini's models that write text, without those made for pictures, speech, embeddings or live talk. */
const NOT_FOR_WRITING = /image|tts|audio|live|embedding|aqa|robotics|computer-use/;

async function listGoogle(base: string, key: string): Promise<Listed[]> {
  const body = await fetchList('google', `${base}/models?pageSize=1000`, { 'x-goog-api-key': key });
  const parsed = GoogleModels.safeParse(body);
  if (!parsed.success) {
    throw new KeyError('Google answered in a shape the writer doesn’t know.', false);
  }
  const listed: Listed[] = [];
  for (const model of parsed.data.models) {
    const id = model.name.replace(/^models\//, '');
    const writes = model.supportedGenerationMethods.includes('generateContent');
    if (!id.startsWith('gemini') || !writes || NOT_FOR_WRITING.test(id)) {
      continue;
    }
    listed.push({
      id,
      name: model.displayName ?? id,
      contextWindow: model.inputTokenLimit ?? CONTEXT_WINDOW,
      maxTokens: model.outputTokenLimit ?? MAX_TOKENS,
    });
  }
  return listed;
}

const AnthropicModels = z.object({
  data: z.array(z.object({ id: z.string(), display_name: z.string().optional() })).default([]),
});

async function listAnthropic(base: string, key: string): Promise<Listed[]> {
  const headers = { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  const body = await fetchList('anthropic', `${base}/v1/models?limit=1000`, headers);
  const parsed = AnthropicModels.safeParse(body);
  if (!parsed.success) {
    throw new KeyError('Anthropic answered in a shape the writer doesn’t know.', false);
  }
  const listed: Listed[] = [];
  for (const model of parsed.data.data) {
    if (!model.id.startsWith('claude')) {
      continue;
    }
    listed.push({ id: model.id, name: model.display_name ?? model.id, contextWindow: 200_000, maxTokens: MAX_TOKENS });
  }
  return listed;
}

const OpenAiModels = z.object({
  data: z.array(z.object({ id: z.string() })).default([]),
});

/** OpenAI's models that write through the Responses API, without those for speech, pictures or search. */
const OPENAI_WRITERS = /^(gpt-5|gpt-4\.1|o3|o4)/;
const OPENAI_NOT_FOR_WRITING = /audio|realtime|transcribe|tts|image|search|instruct|embedding/;

async function listOpenAi(base: string, key: string): Promise<Listed[]> {
  const body = await fetchList('openai', `${base}/models`, { authorization: `Bearer ${key}` });
  const parsed = OpenAiModels.safeParse(body);
  if (!parsed.success) {
    throw new KeyError('OpenAI answered in a shape the writer doesn’t know.', false);
  }
  const listed: Listed[] = [];
  for (const model of parsed.data.data) {
    if (!OPENAI_WRITERS.test(model.id) || OPENAI_NOT_FOR_WRITING.test(model.id)) {
      continue;
    }
    let contextWindow = CONTEXT_WINDOW;
    if (model.id.startsWith('gpt-5')) {
      contextWindow = 400_000;
    }
    listed.push({ id: model.id, name: model.id, contextWindow, maxTokens: MAX_TOKENS });
  }
  return listed;
}

/** pi's API for a provider's models. */
const APIS: Record<KeyProvider, Api> = {
  google: 'google-generative-ai',
  anthropic: 'anthropic-messages',
  openai: 'openai-responses',
};

/**
 * The thinking levels a model takes, as pi reads them, or null for a model that doesn't think.
 * Gemini 3 takes low and high, Claude a budget for any level, and OpenAI's reasoning models an
 * effort that can't be off.
 */
function thinkingFor(provider: KeyProvider, id: string): ThinkingLevelMap | null {
  if (provider === 'google') {
    if (/gemini-3/.test(id)) {
      return { off: null, minimal: null, low: 'low', medium: null, high: 'high' };
    }
    if (/gemini-2\.5/.test(id)) {
      return {};
    }
    return null;
  }
  if (provider === 'anthropic') {
    if (/claude-3-(?!7)/.test(id)) {
      return null;
    }
    return {};
  }
  if (/^(gpt-5|o3|o4)/.test(id)) {
    return { off: null };
  }
  return null;
}

function modelOf(provider: KeyProvider, base: string, listed: Listed): Model<Api> {
  const map = thinkingFor(provider, listed.id);
  const model: Model<Api> = {
    id: listed.id,
    name: listed.name,
    api: APIS[provider],
    provider,
    baseUrl: base,
    input: ['text'],
    // What the writer's own key costs is between them and their provider.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: map !== null,
    contextWindow: listed.contextWindow,
    maxTokens: listed.maxTokens,
  };
  if (map) {
    model.thinkingLevelMap = map;
  }
  return model;
}

/** The models a key reaches, as pi's models. Throws a KeyError when the provider turns it away or can't be reached. */
export async function modelsWithKey(provider: KeyProvider, urls: ProviderUrls, key: string): Promise<Model<Api>[]> {
  const base = urls[provider];
  let listed: Listed[];
  if (provider === 'google') {
    listed = await listGoogle(base, key);
  } else if (provider === 'anthropic') {
    listed = await listAnthropic(base, key);
  } else {
    listed = await listOpenAi(base, key);
  }
  const models = listed.map((entry) => modelOf(provider, base, entry));
  models.sort((one, other) => one.name.localeCompare(other.name));
  return models;
}
