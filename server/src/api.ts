import { serve } from '@hono/node-server';
import { Catalog } from './ai/catalog.ts';
import { OwnAi } from './ai/own/own.ts';
import { PROVIDER_URLS } from './ai/own/providers.ts';
import { sealingKey } from './ai/own/seal.ts';
import { startWritersProxy } from './ai/own/writers_proxy.ts';
import { proxyFrom, type Proxy } from './ai/proxy.ts';
import { backgroundScribe } from './book/scribe.ts';
import { makeApp } from './app.ts';
import { breaderDb, makePool, writerDb } from './db/client.ts';
import { loadEnv } from './env.ts';
import { log } from './log.ts';

const env = loadEnv();

const pool = makePool(env.DATABASE_URL, { ssl: env.DATABASE_SSL === 'require', name: 'writer' });
// Breader's logins live in the same database in production. Locally they come from prod breader.
let breaderPool = pool;
if (env.BREADER_DATABASE_URL) {
  breaderPool = makePool(env.BREADER_DATABASE_URL, { ssl: env.BREADER_DATABASE_SSL === 'require', name: 'breader', max: 2 });
}
if (env.WRITER_EMAILS.length === 0 && !env.OPEN_TO_ALL) {
  log.warn('WRITER_EMAILS is empty, so nobody can write');
}

// The models come through Procreator's CLIProxyAPI. Without one, the AI is offline here.
const proxy = proxyFrom(env);
let catalog: Catalog | null = null;
if (proxy) {
  catalog = new Catalog(proxy);
} else {
  log.warn('CLIPROXY_URL is unset, so the AI is offline');
}

// Writers' own keys are kept sealed with KEYS_SECRET, and the writers' proxy's keys are made from
// it. Without it, this server takes neither keys nor sign-ins.
const stopping = new AbortController();
let sealing: Buffer | null = null;
let writersProxy: Proxy | null = null;
if (env.KEYS_SECRET) {
  sealing = sealingKey(env.KEYS_SECRET);
  writersProxy = startWritersProxy({
    bin: env.WRITERS_PROXY_BIN,
    dir: env.WRITERS_PROXY_DIR,
    port: env.WRITERS_PROXY_PORT,
    secret: env.KEYS_SECRET,
    signal: stopping.signal,
  });
} else {
  log.warn('KEYS_SECRET is unset, so writers can’t bring their own AI');
}
const own = new OwnAi(sealing, PROVIDER_URLS, writersProxy);

const deps = { env, db: writerDb(pool), pool, breader: breaderDb(breaderPool), catalog, own, scribe: backgroundScribe() };
const server = serve({ fetch: makeApp(deps).fetch, port: env.PORT, hostname: '0.0.0.0' }, (info) => {
  log.info({ port: info.port, release: env.RELEASE }, 'writer api listening');
});

const stop = () => {
  log.info('shutting down');
  stopping.abort();
  server.close(() => {
    const pools = [pool.end()];
    if (breaderPool !== pool) {
      pools.push(breaderPool.end());
    }
    void Promise.all(pools).finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 10_000).unref();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
