import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { hkdfSync } from 'node:crypto';
import { join } from 'node:path';
import { log } from '../../log.ts';
import type { Proxy } from '../proxy.ts';

/*
 * The writers' proxy (step 9): a CLIProxyAPI of the API's own, for writers' own sign-ins, run as a
 * process beside it the way breader's worker runs the house's, and started again a minute after it
 * stops. It listens on the API's own machine only. Its settings are written fresh at each start,
 * beside the sign-ins, which outlive the container. It forces prefixes, so a call reaches only the
 * sign-ins of the writer whose prefix it carries (signins.ts), and it never touches the house's
 * proxy, whose settings are breader's.
 */

const AGAIN_MS = 60_000;

export interface WritersProxyOptions {
  /** Where the binary is: the image has it at /usr/local/bin/cli-proxy-api. */
  bin: string;
  /** Where its settings and the sign-ins are kept. */
  dir: string;
  port: number;
  /** KEYS_SECRET: its keys are made from it. */
  secret: string;
  signal: AbortSignal;
}

/** One of its keys, made from KEYS_SECRET, the same at every start. */
function keyFrom(secret: string, what: string): string {
  const key = hkdfSync('sha256', secret, 'breader-writer', `writers proxy ${what}`, 24);
  return Buffer.from(key).toString('hex');
}

function config(dir: string, port: number, apiKey: string, managementKey: string): string {
  return `config-version: 8
server:
  host: "127.0.0.1"
  port: ${port}
management:
  allow-remote: false
  secret-key: "${managementKey}"
  disable-control-panel: true
access:
  api-keys:
    - "${apiKey}"
oauth:
  auth-dir: "${join(dir, 'auths')}"
  providers:
    antigravity:
      # Only the subscription's own limits: never Google's paid credits.
      antigravity-credits: false
routing:
  strategy: "fill-first"
  # A call without a writer's prefix reaches no writer's sign-in.
  force-model-prefix: true
observability:
  logs:
    logging-to-file: false
    request-log: false
`;
}

/** Starts the writers' proxy, and says how to reach it, or null where there's no binary to run. */
export function startWritersProxy(o: WritersProxyOptions): Proxy | null {
  if (!existsSync(o.bin)) {
    log.info({ bin: o.bin }, 'no CLIProxyAPI here, so writers can’t sign in their own subscriptions');
    return null;
  }
  const apiKey = keyFrom(o.secret, 'api key');
  const managementKey = keyFrom(o.secret, 'management key');
  mkdirSync(join(o.dir, 'auths'), { recursive: true });
  const file = join(o.dir, 'config.yaml');

  let child: ChildProcess | null = null;
  let timer: NodeJS.Timeout | undefined;

  const run = () => {
    writeFileSync(file, config(o.dir, o.port, apiKey, managementKey), { mode: 0o600 });
    child = spawn(o.bin, ['-config', file], { cwd: o.dir, stdio: 'inherit' });
    child.on('error', (err) => log.warn({ err }, 'the writers’ proxy could not start'));
    child.on('exit', (code, signal) => {
      child = null;
      if (o.signal.aborted) {
        return;
      }
      log.warn({ code, signal }, 'the writers’ proxy stopped, starting it again in a minute');
      timer = setTimeout(run, AGAIN_MS);
    });
  };

  o.signal.addEventListener('abort', () => {
    clearTimeout(timer);
    child?.kill('SIGTERM');
  });
  run();
  return { url: `http://127.0.0.1:${o.port}`, apiKey, managementKey };
}
