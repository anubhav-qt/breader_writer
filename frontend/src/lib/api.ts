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

/**
 * One request. It gives up after `timeout`, or when `signal` says nobody wants the answer any
 * more; the server sees the request go and stops its work too.
 */
async function request<T>(base: Base, method: string, path: string, body?: unknown, timeout = TIMEOUT, signal?: AbortSignal): Promise<T> {
  if (navigator.onLine === false) throw new OfflineError(base);
  const init: RequestInit = { method, credentials: 'include' };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }

  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeout);
  const stop = () => ctrl.abort();
  if (signal) {
    signal.addEventListener('abort', stop);
  }
  let res: Response;
  try {
    res = await fetch(BASES[base] + path, { ...init, signal: ctrl.signal });
  } catch {
    throw new OfflineError(base);
  } finally {
    window.clearTimeout(timer);
    if (signal) {
      signal.removeEventListener('abort', stop);
    }
  }

  const data = await res.json().catch(() => null);
  if (res.ok) return data as T;
  throw failureFrom(res.status, data, base);
}

/** The error an answer that isn't ok stands for, from its status and its body. */
function failureFrom(status: number, data: { code?: string; message?: string } | null, base: Base): Error {
  // An error without the server's own code came from something in front of it: Cloudflare while
  // the tunnel is down, or the dev server's proxy while the API isn't running.
  if (!data?.code && status >= 500) return new OfflineError(base);
  const code = data?.code ?? 'error';
  const message = data?.message ?? `The server answered ${status}.`;
  return new ApiError(status, code, message);
}

/** Hands on each whole server-sent event in what's come so far, and gives back what's left. */
function takeEvents(received: string, onData: (data: unknown) => void): string {
  const events = received.split('\n\n');
  // The last part is an event still on its way, or nothing.
  const rest = events.pop() ?? '';
  for (const event of events) {
    const lines: string[] = [];
    for (const line of event.split('\n')) {
      if (line.startsWith('data:')) {
        lines.push(line.slice('data:'.length).trimStart());
      }
    }
    if (lines.length > 0) {
      onData(JSON.parse(lines.join('\n')));
    }
  }
  return rest;
}

/**
 * A POST to the writer's API whose answer streams back as server-sent events: each event's data
 * goes to onData as it comes. There's no time limit, since the model may think a long while;
 * `signal` stops it. It fails as a request does before the stream starts, and with OfflineError
 * if the stream breaks off.
 */
export async function streamEvents(path: string, body: unknown, onData: (data: unknown) => void, signal: AbortSignal): Promise<void> {
  if (navigator.onLine === false) throw new OfflineError('writer');
  const init: RequestInit = {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  };
  let res: Response;
  try {
    res = await fetch(BASES.writer + path, init);
  } catch (e) {
    if (signal.aborted) throw e;
    throw new OfflineError('writer');
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null);
    throw failureFrom(res.status, data, 'writer');
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let received = '';
  while (true) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch (e) {
      if (signal.aborted) throw e;
      throw new OfflineError('writer');
    }
    if (chunk.done) {
      return;
    }
    received = takeEvents(received + chunk.value, onData);
  }
}

function client(base: Base) {
  return {
    get: <T>(path: string, timeout?: number) => request<T>(base, 'GET', path, undefined, timeout),
    post: <T>(path: string, body: unknown = {}, timeout?: number, signal?: AbortSignal) => request<T>(base, 'POST', path, body, timeout, signal),
    put: <T>(path: string, body: unknown, timeout?: number) => request<T>(base, 'PUT', path, body, timeout),
    delete: <T>(path: string, timeout?: number) => request<T>(base, 'DELETE', path, undefined, timeout),
  };
}

export const writer = client('writer');
export const breader = client('breader');

/** The address of something on the writer's API, for a link the browser follows itself (a download). */
export function writerUrl(path: string): string {
  return BASES.writer + path;
}

/** What to tell the owner when a request failed: the server's own words, or that it's offline. */
export function failureText(e: unknown): string {
  if (e instanceof ApiError || e instanceof OfflineError) {
    return e.message;
  }
  return 'Something went wrong. Try again in a moment.';
}
