import { Hono } from 'hono';
import { KeyAsk, KeyProvider, SignInAddress, StartSignIn, type AiAccount, type OwnAi as OwnAiView } from '@writer/shared/protocol';
import { addressProblem } from '../ai/accounts.ts';
import { KeysOff } from '../ai/own/own.ts';
import { KeyError } from '../ai/own/providers.ts';
import { SignInBusy, type WritersSignIns } from '../ai/own/signins.ts';
import { ProxyError } from '../ai/proxy.ts';
import type { AppEnv, Deps } from '../context.ts';
import { requireWriter } from '../lib/access.ts';
import { ApiError, parse, readJson } from '../lib/errors.ts';

/*
 * A writer's own AI (step 9), for every writer: the API keys they bring, kept sealed and checked
 * with their provider first, and the subscriptions they sign in to the writers' proxy, one sign-in
 * at a time on the server. Its models join the model picker's.
 */

/** What to tell a writer when the writers' proxy said no, or couldn't be reached. */
function proxyFailure(err: unknown): unknown {
  if (err instanceof SignInBusy) {
    return new ApiError(409, 'sign_in_busy', err.message);
  }
  if (!(err instanceof ProxyError)) {
    return err;
  }
  if (err.status === 0) {
    return new ApiError(503, 'sign_ins_offline', 'Signing in can’t be reached right now. Try again in a minute.');
  }
  let reason = `it answered ${err.status}`;
  if (err.reason) {
    reason = err.reason;
  }
  return new ApiError(502, 'proxy_refused', `Signing in didn’t work: ${reason}.`);
}

async function withProxy<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    throw proxyFailure(err);
  }
}

const noSignIn = () => new ApiError(404, 'not_found', 'There’s no such sign-in waiting.');

const unknownProvider = () => new ApiError(404, 'not_found', 'The writer takes keys for Google, Anthropic and OpenAI.');

/** The provider in the path, or a 404. */
function providerOf(raw: string): KeyProvider {
  const provider = KeyProvider.safeParse(raw);
  if (!provider.success) {
    throw unknownProvider();
  }
  return provider.data;
}

export function ownRoutes(deps: Deps) {
  const r = new Hono<AppEnv>();
  r.use('/own', requireWriter(deps));
  r.use('/own/*', requireWriter(deps));

  /** The account's own AI as settings show it. */
  async function ownNow(userId: string): Promise<OwnAiView> {
    const keys = await deps.own.keys(deps.db, userId);
    let signIns: AiAccount[] = [];
    const writers = deps.own.signIns;
    if (writers) {
      signIns = await writers.list(deps.db, userId);
    }
    return { keys, signIns, keysHere: deps.own.sealing !== null, signInsHere: writers !== null };
  }

  /** The writers' sign-ins, where this server takes them. */
  function signInsHere(): WritersSignIns {
    const writers = deps.own.signIns;
    if (!writers) {
      throw new ApiError(503, 'sign_ins_off', 'This server doesn’t take sign-ins: it runs no writers’ proxy.');
    }
    return writers;
  }

  /** The sign-in in the path, while it's the account's and waiting. */
  function theirSignIn(userId: string, state: string): WritersSignIns {
    const writers = signInsHere();
    if (!writers.isTheirs(userId, state)) {
      throw noSignIn();
    }
    return writers;
  }

  r.get('/own', async (c) => {
    return c.json(await ownNow(c.var.login.id));
  });

  /** Keeps the account's key for a provider, once the provider takes it, in place of the one before. */
  r.put('/own/keys/:provider', async (c) => {
    const provider = providerOf(c.req.param('provider'));
    const ask = parse(KeyAsk, await readJson(c));
    const userId = c.var.login.id;
    try {
      await deps.own.saveKey(deps.db, userId, provider, ask.key);
    } catch (err) {
      if (err instanceof KeysOff) {
        throw new ApiError(503, 'keys_off', 'This server doesn’t take keys yet: it has no KEYS_SECRET.');
      }
      if (err instanceof KeyError && err.refused) {
        throw new ApiError(400, 'key_refused', err.message);
      }
      if (err instanceof KeyError) {
        throw new ApiError(502, 'provider_down', err.message);
      }
      throw err;
    }
    return c.json(await ownNow(userId));
  });

  /** Forgets the account's key for a provider. */
  r.delete('/own/keys/:provider', async (c) => {
    const provider = providerOf(c.req.param('provider'));
    const userId = c.var.login.id;
    await deps.own.removeKey(deps.db, userId, provider);
    return c.json(await ownNow(userId));
  });

  /** Starts signing one of the account's own subscriptions in, and gives the page to sign in on. */
  r.post('/own/sign-in', async (c) => {
    const { provider } = parse(StartSignIn, await readJson(c));
    const writers = signInsHere();
    const signIn = await withProxy(() => writers.start(deps.db, c.var.login.id, provider));
    return c.json(signIn);
  });

  /** How the account's sign-in stands. Once it's in, it's the account's, and its models show. */
  r.get('/own/sign-in/:state', async (c) => {
    const userId = c.var.login.id;
    const state = c.req.param('state');
    const writers = theirSignIn(userId, state);
    const status = await withProxy(() => writers.status(deps.db, userId, state));
    if (status.status === 'ok') {
      deps.own.forgetSignIns(userId);
    }
    return c.json(status);
  });

  /** The address the sign-in page ended on, which can't load away from the writers' proxy. */
  r.post('/own/sign-in/:state', async (c) => {
    const { address } = parse(SignInAddress, await readJson(c));
    const state = c.req.param('state');
    const writers = theirSignIn(c.var.login.id, state);
    const problem = addressProblem(address, state);
    if (problem) {
      throw new ApiError(400, 'bad_address', problem);
    }
    await withProxy(() => writers.finish(state, address));
    return c.body(null, 204);
  });

  /** Stops waiting for the account's sign-in. */
  r.delete('/own/sign-in/:state', async (c) => {
    const state = c.req.param('state');
    const writers = theirSignIn(c.var.login.id, state);
    await withProxy(() => writers.cancel(state));
    return c.body(null, 204);
  });

  /** Signs one of the account's own subscriptions out. Its models go with it. */
  r.delete('/own/sign-ins/:name', async (c) => {
    const userId = c.var.login.id;
    const writers = signInsHere();
    const gone = await withProxy(() => writers.signOut(deps.db, userId, c.req.param('name')));
    if (!gone) {
      throw new ApiError(404, 'not_found', 'There’s no such sign-in of yours.');
    }
    deps.own.forgetSignIns(userId);
    return c.json(await ownNow(userId));
  });

  return r;
}
