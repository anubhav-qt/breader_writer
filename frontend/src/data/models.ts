import { Settings, type ModelChoice, type ModelInfo, type ThinkingLevel } from '@writer/shared/protocol';
import { writer } from '../lib/api';

/*
 * The model the owner's stories run on, and how hard it thinks: picked in the header, once for
 * every book. The models are whatever the accounts signed in to Seelie's proxy serve.
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

/** The account kinds Seelie signs in, by the names their owners know them by. */
const PROVIDER_NAMES: Record<string, string> = {
  antigravity: 'Antigravity',
  codex: 'ChatGPT',
  claude: 'Claude',
};

export function providerName(provider: string): string {
  return PROVIDER_NAMES[provider] ?? provider;
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
