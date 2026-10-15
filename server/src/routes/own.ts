import { Hono } from 'hono';
import { KeyAsk, KeyProvider, type OwnAi as OwnAiView } from '@writer/shared/protocol';
import { KeysOff } from '../ai/own/own.ts';
import { KeyError } from '../ai/own/providers.ts';
import type { AppEnv, Deps } from '../context.ts';
import { requireWriter } from '../lib/access.ts';
import { ApiError, parse, readJson } from '../lib/errors.ts';

/*
 * A writer's own AI (step 9), for every writer: the API keys they bring, kept sealed and checked
 * with their provider first. Its models join the model picker's.
 */

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
    return { keys, signIns: [], keysHere: deps.own.sealing !== null, signInsHere: false };
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

  return r;
}
