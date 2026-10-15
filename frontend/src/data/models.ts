import { Settings, type HouseStanding, type KeyProvider, type ModelChoice, type ModelInfo, type ThinkingLevel } from '@writer/shared/protocol';
import { writer } from '../lib/api';

/*
 * The model the owner's stories run on, and how hard it thinks: picked in the header, once for
 * every book. The models are whatever the accounts signed in to Procreator's proxy serve, and
 * for every writer but the owner, whatever their own AI reaches.
 */

/** The server asks the proxy, which can take a while the first time. */
const TIMEOUT = 20_000;

export async function fetchSettings(): Promise<Settings> {
  const data = await writer.get<unknown>('/v1/settings', TIMEOUT);
  return Settings.parse(data);
}

export async function saveChoice(choice: ModelChoice): Promise<Settings> {
  const data = await writer.put<unknown>('/v1/settings', choice, TIMEOUT);
  return Settings.parse(data);
}

/** Each level's name, short enough to sit side by side in the picker. */
const THINKING_NAMES: Record<ThinkingLevel, string> = {
  off: 'Off',
  minimal: 'Min',
  low: 'Low',
  medium: 'Med',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max',
};

export function thinkingName(level: ThinkingLevel): string {
  return THINKING_NAMES[level];
}

/** The account kinds Procreator signs in, by the names their owners know them by. */
const PROVIDER_NAMES: Record<string, string> = {
  antigravity: 'Antigravity',
  codex: 'ChatGPT',
  claude: 'Claude',
};

export function providerName(provider: string): string {
  return PROVIDER_NAMES[provider] ?? provider;
}

const KEY_PROVIDER_NAMES: Record<KeyProvider, string> = {
  google: 'Google',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
};

/** Who a writer's own key is for. */
export function keyProviderName(provider: KeyProvider): string {
  return KEY_PROVIDER_NAMES[provider];
}

/**
 * Where a model comes from, as its row says: the house's account that serves it, or "On the
 * house" while the house writes only the free chapter, or the writer's own key or sign-in.
 */
export function sourceName(model: ModelInfo, house: HouseStanding): string {
  if (model.source === 'house' && house === 'always') {
    return providerName(model.provider);
  }
  if (model.source === 'house') {
    return 'On the house';
  }
  if (model.source === 'signin') {
    return `Your ${providerName(model.provider)} sign-in`;
  }
  return `Your ${keyProviderName(model.source)} key`;
}

/** 1,048,576 tokens reads as "1M", 200,000 as "200k". */
export function contextName(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = Math.round(tokens / 100_000) / 10;
    return `${millions}M`;
  }
  return `${Math.round(tokens / 1000)}k`;
}

/** Whether there's a thinking level to pick: a model that takes only "off" thinks at its own pace. */
export function picksThinking(model: ModelInfo | undefined): boolean {
  if (!model) {
    return false;
  }
  return model.thinkingLevels.some((level) => level !== 'off');
}
