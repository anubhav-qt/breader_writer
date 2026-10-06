import { Hono } from 'hono';
import { SignInAddress, StartSignIn, type AiAccounts } from '@writer/shared/protocol';
import {
  addressProblem,
  cancelSignIn,
  finishSignIn,
  listAccounts,
  signInStatus,
  signOut,
  startSignIn,
} from '../ai/accounts.ts';
import { ProxyError, type Proxy } from '../ai/proxy.ts';
import type { AppEnv, Deps } from '../context.ts';
import { requireOwner, requireWriter } from '../lib/access.ts';
import { ApiError, parse, readJson } from '../lib/errors.ts';

/*
 * The AI accounts signed in to the proxy, which every story runs on. Only the owner sees them,
 * and signs them in and out here, through the proxy's management API (ai/accounts.ts).
 */

/** The proxy, when it can be managed from here. */
function managedProxy(deps: Deps): Proxy {
  const proxy = deps.catalog?.proxy;
  if (!proxy) {
    throw new ApiError(503, 'ai_offline', 'The AI is offline: the writer has no proxy to sign accounts in to.');
  }
  if (!proxy.managementKey) {
    throw new ApiError(
      503,
      'no_management_key',
      'To sign accounts in here, give the writer’s server the proxy’s management key (CLIPROXY_MANAGEMENT_KEY).',
    );
  }
  return proxy;
}

/** What to tell the owner when the proxy said no, or couldn't be reached. */
function proxyFailure(err: unknown): unknown {
  if (!(err instanceof ProxyError)) {
    return err;
  }
  if (err.status === 0) {
    return new ApiError(503, 'ai_offline', 'The AI is offline: the proxy can’t be reached. It comes back by itself.');
  }
  if (err.status === 401) {
    return new ApiError(
      502,
      'management_refused',
      'The proxy turned the management key away. Check CLIPROXY_MANAGEMENT_KEY on the writer’s server.',
    );
  }
  let reason = `it answered ${err.status}`;
  if (err.reason) {
    reason = err.reason;
  }
  return new ApiError(502, 'proxy_refused', `The proxy said no: ${reason}.`);
}

async function withProxy<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    throw proxyFailure(err);
  }
}

export function accountRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();
  r.use('/accounts', requireWriter(deps), requireOwner(deps));
  r.use('/accounts/*', requireWriter(deps), requireOwner(deps));

  /** Every account signed in to the proxy. */
  r.get('/accounts', async (c) => {
    const proxy = managedProxy(deps);
    const accounts = await withProxy(() => listAccounts(proxy));
    const body: AiAccounts = { accounts };
    return c.json(body);
  });

  /** Starts signing an account in, and gives the page to sign in on. */
  r.post('/accounts/sign-in', async (c) => {
    const { provider } = parse(StartSignIn, await readJson(c));
    const proxy = managedProxy(deps);
    const signIn = await withProxy(() => startSignIn(proxy, provider));
    return c.json(signIn);
  });

  /** How a sign-in stands. Once it's in, the models are read again, so the new account's show. */
  r.get('/accounts/sign-in/:state', async (c) => {
    const proxy = managedProxy(deps);
    const status = await withProxy(() => signInStatus(proxy, c.req.param('state')));
    if (status.status === 'ok') {
      deps.catalog?.forget();
    }
    return c.json(status);
  });

  /** The address the sign-in page ended on, for when that page couldn't load. */
  r.post('/accounts/sign-in/:state', async (c) => {
    const { address } = parse(SignInAddress, await readJson(c));
    const state = c.req.param('state');
    const problem = addressProblem(address, state);
    if (problem) {
      throw new ApiError(400, 'bad_address', problem);
    }
    const proxy = managedProxy(deps);
    await withProxy(() => finishSignIn(proxy, state, address));
    return c.body(null, 204);
  });

  /** Stops waiting for a sign-in. */
  r.delete('/accounts/sign-in/:state', async (c) => {
    const proxy = managedProxy(deps);
    await withProxy(() => cancelSignIn(proxy, c.req.param('state')));
    return c.body(null, 204);
  });

  /** Signs an account out, and gives the accounts left. Its models go with it. */
  r.delete('/accounts/:id', async (c) => {
    const proxy = managedProxy(deps);
    await withProxy(() => signOut(proxy, c.req.param('id')));
    deps.catalog?.forget();
    const accounts = await withProxy(() => listAccounts(proxy));
    const body: AiAccounts = { accounts };
    return c.json(body);
  });

  return r;
}
