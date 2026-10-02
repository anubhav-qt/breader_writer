import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Catalog } from '../src/ai/catalog.ts';
import { account, address, call, send, writer } from './helpers.ts';
import { antigravity, catalogOf, fakeProxy, type FakeProxy } from './proxy.ts';

let proxy: FakeProxy;

beforeAll(async () => {
  proxy = await fakeProxy(antigravity());
});

afterAll(async () => {
  await proxy.close();
});

/** A writer that can write, with its models from this catalog, and its login. */
async function setUp(catalog: Catalog | null) {
  const email = address('settings');
  const app = writer({ WRITER_EMAILS: [email] }, catalog);
  const cookie = await account(email, true);
  return { app, cookie };
}

describe('GET /v1/settings', () => {
  it('is closed without a login', async () => {
    const out = await call(writer({}, catalogOf(proxy)), 'GET', '/v1/settings');
    expect(out.status).toBe(401);
  });

  it('lists the models the proxy serves, the default first, without the ones that draw', async () => {
    const { app, cookie } = await setUp(catalogOf(proxy));
    const r = await call(app, 'GET', '/v1/settings', cookie);
    expect(r.status).toBe(200);
    expect(r.body.using).toEqual({ model: 'gemini-3.8-flash-high', thinking: 'high' });
    const ids = r.body.models.map((model: { id: string }) => model.id);
    expect(ids).toEqual(['gemini-3.8-flash-high', 'claude-sonnet-4-6', 'gpt-oss-120b-medium']);
  });

  it('gives each model the thinking levels it takes', async () => {
    const { app, cookie } = await setUp(catalogOf(proxy));
    const r = await call(app, 'GET', '/v1/settings', cookie);
    const byId = new Map(r.body.models.map((model: { id: string }) => [model.id, model]));
    expect(byId.get('gemini-3.8-flash-high')).toEqual({
      id: 'gemini-3.8-flash-high',
      name: 'Gemini 3.8 Flash',
      provider: 'antigravity',
      contextWindow: 1_048_576,
      thinkingLevels: ['minimal', 'low', 'medium', 'high'],
    });
    expect(byId.get('claude-sonnet-4-6')).toMatchObject({ thinkingLevels: ['off', 'minimal', 'low', 'medium', 'high'] });
    // Nothing known about it: a name from its id, and no thinking.
    expect(byId.get('gpt-oss-120b-medium')).toMatchObject({ name: 'Gpt Oss 120b Medium', thinkingLevels: ['off'] });
  });

  it('still lists the models without the management key, just without thinking', async () => {
    const { app, cookie } = await setUp(catalogOf(proxy, ''));
    const r = await call(app, 'GET', '/v1/settings', cookie);
    expect(r.body.models).toHaveLength(4);
    expect(r.body.using).toEqual({ model: 'gemini-3.8-flash-high', thinking: 'off' });
  });

  it('says the AI is offline without a proxy, or while it is down', async () => {
    const none = await setUp(null);
    const unset = await call(none.app, 'GET', '/v1/settings', none.cookie);
    expect(unset.body).toEqual({ using: { model: 'gemini-3.8-flash-high', thinking: 'high' }, models: null });

    const gone = await fakeProxy(antigravity());
    await gone.close();
    const down = await setUp(catalogOf(gone));
    const r = await call(down.app, 'GET', '/v1/settings', down.cookie);
    expect(r.status).toBe(200);
    expect(r.body.models).toBeNull();
  });
});

describe('PUT /v1/settings', () => {
  it('keeps the account’s choice', async () => {
    const { app, cookie } = await setUp(catalogOf(proxy));
    const r = await send(app, 'PUT', '/v1/settings', cookie, { model: 'claude-sonnet-4-6', thinking: 'low' });
    expect(r.status).toBe(200);
    expect(r.body.using).toEqual({ model: 'claude-sonnet-4-6', thinking: 'low' });

    const again = await call(app, 'GET', '/v1/settings', cookie);
    expect(again.body.using).toEqual({ model: 'claude-sonnet-4-6', thinking: 'low' });
  });

  it('turns away a model nobody serves, and a level the model doesn’t take', async () => {
    const { app, cookie } = await setUp(catalogOf(proxy));
    const unknown = await send(app, 'PUT', '/v1/settings', cookie, { model: 'gemini-9', thinking: 'high' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe('unknown_model');

    const level = await send(app, 'PUT', '/v1/settings', cookie, { model: 'gemini-3.8-flash-high', thinking: 'off' });
    expect(level.status).toBe(400);
    expect(level.body.message).toBe('Gemini 3.8 Flash doesn’t take that thinking level.');
  });

  it('can’t change while the AI is offline', async () => {
    const { app, cookie } = await setUp(null);
    const r = await send(app, 'PUT', '/v1/settings', cookie, { model: 'gemini-3.8-flash-high', thinking: 'high' });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('ai_offline');
  });

  it('falls back to the default when the chosen model is no longer served, at the nearest level', async () => {
    const served = antigravity();
    const changing = await fakeProxy(served);
    const email = address('settings');
    const cookie = await account(email, true);

    const before = writer({ WRITER_EMAILS: [email] }, catalogOf(changing));
    await send(before, 'PUT', '/v1/settings', cookie, { model: 'claude-sonnet-4-6', thinking: 'off' });

    changing.served.models = changing.served.models.filter((model) => model.id !== 'claude-sonnet-4-6');
    const after = writer({ WRITER_EMAILS: [email] }, catalogOf(changing));
    const r = await call(after, 'GET', '/v1/settings', cookie);
    expect(r.body.using).toEqual({ model: 'gemini-3.8-flash-high', thinking: 'minimal' });
    await changing.close();
  });
});
