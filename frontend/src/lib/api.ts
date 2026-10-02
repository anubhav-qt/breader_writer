/*
 * The app talks to two servers. The writer's own API has the books and says who may write.
 * Breader's API does the logging in: its login cookie is on the parent domain, so the writer's
 * server reads the same login.
 *
 * The writer's API runs on the ThinkPad alone, with no fallback. While it's off, asking it fails
 * with OfflineError, and the app says the writer is offline.
 */
const BASES = {
  writer: import.meta.env.VITE_API_URL || '/writer/api',
  breader: import.meta.env.VITE_BREADER_API_URL || 'https://api.breader.site',
};
type Base = keyof typeof BASES;

const TIMEOUT = 8000;

const UNREACHABLE: Record<Base, string> = {
  writer: 'The writer can’t reach its server right now. It comes back by itself.',
  breader: 'Breader can’t be reached right now. Try again in a while.',
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class OfflineError extends Error {
  constructor(base: Base) {
    super(UNREACHABLE[base]);
  }
}

async function request<T>(base: Base, method: string, path: string, body?: unknown, timeout = TIMEOUT): Promise<T> {
  if (navigator.onLine === false) throw new OfflineError(base);
  const init: RequestInit = { method, credentials: 'include' };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }

  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeout);
  let res: Response;
  try {
    res = await fetch(BASES[base] + path, { ...init, signal: ctrl.signal });
  } catch {
    throw new OfflineError(base);
  } finally {
    window.clearTimeout(timer);
  }

  const data = await res.json().catch(() => null);
  if (res.ok) return data as T;
  // An error without the server's own code came from something in front of it: Cloudflare while
  // the tunnel is down, or the dev server's proxy while the API isn't running.
  if (!data?.code && res.status >= 500) throw new OfflineError(base);
  const code = data?.code ?? 'error';
  const message = data?.message ?? `The server answered ${res.status}.`;
  throw new ApiError(res.status, code, message);
}

function client(base: Base) {
  return {
    get: <T>(path: string, timeout?: number) => request<T>(base, 'GET', path, undefined, timeout),
    post: <T>(path: string, body: unknown = {}, timeout?: number) => request<T>(base, 'POST', path, body, timeout),
  };
}

export const writer = client('writer');
export const breader = client('breader');
