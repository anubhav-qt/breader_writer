import { getSupportedThinkingLevels, type Api, type Model, type ThinkingLevelMap } from '@writer/pi-ai';
import { ThinkingLevel, type ModelInfo } from '@writer/shared/protocol';
import { listModels, modelDefinitions, type Listed, type ModelDefinition, type Proxy } from './proxy.ts';

/*
 * The models the writer can use: whatever the accounts signed in to the proxy serve, described by
 * what the proxy knows about each (its name, context and the thinking levels it takes). Read
 * again once a minute at most.
 */

/** A new account's model until it picks one: Gemini 3.8 Flash, as Antigravity names it, else as Google does. */
export const DEFAULT_MODELS = ['gemini-3.8-flash-high', 'gemini-3.8-flash'];
export const DEFAULT_THINKING: ThinkingLevel = 'high';

const FRESH_FOR_MS = 60_000;
/** Used when the proxy doesn't say. */
const CONTEXT_WINDOW = 128_000;
const MAX_TOKENS = 32_000;

interface Loaded {
  at: number;
  models: Map<string, Model<Api>>;
  /** As settings show them, the default first. */
  infos: ModelInfo[];
}

/** Which of pi's APIs speaks to a model, and where under the proxy it's served. */
function apiFor(id: string, provider: string): { api: Api; path: string } {
  const lower = id.toLowerCase();
  if (lower.startsWith('gemini')) {
    return { api: 'google-generative-ai', path: '/v1beta' };
  }
  if (lower.startsWith('claude')) {
    // The Anthropic SDK adds /v1/messages itself.
    return { api: 'anthropic-messages', path: '' };
  }
  const codex = provider === 'codex' || lower.includes('codex') || lower.startsWith('gpt-5');
  if (codex) {
    return { api: 'openai-responses', path: '/v1' };
  }
  return { api: 'openai-completions', path: '/v1' };
}

/**
 * pi's thinking levels for a model, from what the proxy knows. Gemini names the levels it takes;
 * Claude and the OpenAI models take any level (as a token budget or an effort) but the two
 * extra ones. A level the model can't take is null. No thinking at all is null for the map.
 */
function thinkingMap(definition: ModelDefinition | undefined): ThinkingLevelMap | null {
  const thinking = definition?.thinking;
  if (!thinking) {
    return null;
  }
  const map: ThinkingLevelMap = {};
  if (!thinking.zero_allowed) {
    map.off = null;
  }
  const named = thinking.levels ?? [];
  if (named.length === 0) {
    map.xhigh = null;
    map.max = null;
    return map;
  }
  const takes = new Set(named.map((level) => level.toLowerCase()));
  for (const level of ThinkingLevel.options) {
    if (level === 'off') {
      continue;
    }
    if (takes.has(level)) {
      map[level] = level;
    } else {
      map[level] = null;
    }
  }
  return map;
}

/** "gemini-3.8-flash-high" reads as "Gemini 3.8 Flash High". */
function titleFromId(id: string): string {
  const words = id.split(/[-_]+/);
  const titled = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return titled.join(' ');
}

/** Models that answer with pictures, not the text and tool calls a story runs on. */
function drawsPictures(definition: ModelDefinition | undefined): boolean {
  const outputs = definition?.supportedOutputModalities ?? [];
  return outputs.includes('image');
}

function modelFor(proxy: Proxy, listed: Listed, definition: ModelDefinition | undefined): Model<Api> {
  const { api, path } = apiFor(listed.id, listed.owned_by);
  const map = thinkingMap(definition);
  const model: Model<Api> = {
    id: listed.id,
    name: definition?.display_name ?? titleFromId(listed.id),
    api,
    provider: listed.owned_by,
    baseUrl: proxy.url + path,
    input: ['text'],
    // The subscriptions are paid for already.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: map !== null,
    contextWindow: definition?.context_length ?? CONTEXT_WINDOW,
    maxTokens: definition?.max_completion_tokens ?? MAX_TOKENS,
  };
  if (map) {
    model.thinkingLevelMap = map;
  }
  return model;
}

function infoFor(model: Model<Api>): ModelInfo {
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    contextWindow: model.contextWindow,
    thinkingLevels: getSupportedThinkingLevels(model),
  };
}

/** The default model among those served, or null when none of them is. */
export function defaultIn(ids: Set<string>): string | null {
  for (const id of DEFAULT_MODELS) {
    if (ids.has(id)) {
      return id;
    }
  }
  return null;
}

/** The default first, then by account kind and name. */
function inShowingOrder(infos: ModelInfo[]): ModelInfo[] {
  const ids = new Set(infos.map((info) => info.id));
  const first = defaultIn(ids);
  return [...infos].sort((one, other) => {
    if (one.id === first) {
      return -1;
    }
    if (other.id === first) {
      return 1;
    }
    const byProvider = one.provider.localeCompare(other.provider);
    if (byProvider !== 0) {
      return byProvider;
    }
    return one.name.localeCompare(other.name);
  });
}

/** What the proxy knows about every model its accounts serve, by id. A kind it can't describe is left out. */
async function definitionsFor(proxy: Proxy, listed: Listed[]): Promise<Map<string, ModelDefinition>> {
  const definitions = new Map<string, ModelDefinition>();
  if (!proxy.managementKey) {
    return definitions;
  }
  const providers = new Set(listed.map((model) => model.owned_by).filter(Boolean));
  const lists = await Promise.all(
    [...providers].map((provider) => modelDefinitions(proxy, provider).catch(() => [])),
  );
  for (const list of lists) {
    for (const definition of list) {
      if (!definitions.has(definition.id)) {
        definitions.set(definition.id, definition);
      }
    }
  }
  return definitions;
}

async function load(proxy: Proxy): Promise<Loaded> {
  const listed = await listModels(proxy);
  const definitions = await definitionsFor(proxy, listed);
  const models = new Map<string, Model<Api>>();
  for (const entry of listed) {
    const definition = definitions.get(entry.id);
    if (models.has(entry.id) || drawsPictures(definition)) {
      continue;
    }
    models.set(entry.id, modelFor(proxy, entry, definition));
  }
  const infos = [...models.values()].map(infoFor);
  return { at: Date.now(), models, infos: inShowingOrder(infos) };
}

/** The models the proxy serves, read again once a minute at most. */
export class Catalog {
  readonly proxy: Proxy;
  private loaded: Loaded | null = null;
  private loading: Promise<Loaded> | null = null;

  constructor(proxy: Proxy) {
    this.proxy = proxy;
  }

  private async current(): Promise<Loaded> {
    const fresh = this.loaded && Date.now() - this.loaded.at < FRESH_FOR_MS;
    if (this.loaded && fresh) {
      return this.loaded;
    }
    if (!this.loading) {
      this.loading = load(this.proxy)
        .then((next) => {
          this.loaded = next;
          return next;
        })
        .finally(() => {
          this.loading = null;
        });
    }
    return this.loading;
  }

  /** Every model, as settings show them, the default first. Throws a ProxyError while the proxy is down. */
  async infos(): Promise<ModelInfo[]> {
    const loaded = await this.current();
    return loaded.infos;
  }

  /** pi's model for an id, or null when no account serves it. */
  async find(id: string): Promise<Model<Api> | null> {
    const loaded = await this.current();
    return loaded.models.get(id) ?? null;
  }
}
