import { serve } from '@hono/node-server';
import { Catalog } from './ai/catalog.ts';
import { proxyFrom } from './ai/proxy.ts';
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

const deps = { env, db: writerDb(pool), pool, breader: breaderDb(breaderPool), catalog, scribe: backgroundScribe() };
const server = serve({ fetch: makeApp(deps).fetch, port: env.PORT, hostname: '0.0.0.0' }, (info) => {
  log.info({ port: info.port, release: env.RELEASE }, 'writer api listening');
});

const stop = () => {
  log.info('shutting down');
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
