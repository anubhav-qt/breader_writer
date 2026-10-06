import { afterEach, describe, expect, it } from 'vitest';
import { account, address, call, send, writer } from './helpers.ts';
import { antigravity, catalogOf, fakeProxy, MANAGEMENT_KEY, type Credential, type FakeProxy } from './proxy.ts';

const opened: FakeProxy[] = [];

afterEach(async () => {
  const closing = opened.splice(0).map((proxy) => proxy.close());
  await Promise.all(closing);
});

/** The Antigravity account the proxy is signed in to, as it lists it. */
function fizz(): Credential {
  return { name: 'antigravity-fizz@example.com.json', provider: 'antigravity', email: 'fizz@example.com', status: 'active' };
}

/** A proxy with Antigravity signed in, and the owner at a writer on it. */
async function setUp(managementKey = MANAGEMENT_KEY) {
  const served = antigravity();
  served.credentials = [fizz()];
  const proxy = await fakeProxy(served);
  opened.push(proxy);
  const owner = address('owner');
  const app = writer({ WRITER_EMAILS: [owner], OWNER_EMAILS: [owner] }, catalogOf(proxy, managementKey));
  const cookie = await account(owner, true);
  return { proxy, app, cookie };
}

/** The ids of the models settings list. */
async function modelIds(app: ReturnType<typeof writer>, cookie: string): Promise<string[]> {
  const r = await call(app, 'GET', '/v1/settings', cookie);
  return r.body.models.map((model: { id: string }) => model.id);
}

describe('the AI accounts', () => {
  it('are the owner’s alone', async () => {
    const { proxy } = await setUp();
    const invited = address('invited');
    const app = writer({ WRITER_EMAILS: [invited], OWNER_EMAILS: [] }, catalogOf(proxy));

    const loggedOut = await call(app, 'GET', '/v1/accounts');
    expect(loggedOut.status).toBe(401);

    const cookie = await account(invited, true);
    const list = await call(app, 'GET', '/v1/accounts', cookie);
    expect(list.status).toBe(403);
    expect(list.body.code).toBe('not_owner');
    const signIn = await send(app, 'POST', '/v1/accounts/sign-in', cookie, { provider: 'antigravity' });
    expect(signIn.status).toBe(403);
    const signOut = await call(app, 'DELETE', `/v1/accounts/${encodeURIComponent(fizz().name)}`, cookie);
    expect(signOut.status).toBe(403);
    expect(proxy.served.credentials).toHaveLength(1);
  });

  it('lists every account signed in to the proxy, and why any can’t serve', async () => {
    const { proxy, app, cookie } = await setUp();
    proxy.served.credentials = [
      { name: 'codex-pat@example.com.json', provider: 'codex', email: 'pat@example.com', unavailable: true, status: 'error', status_message: 'quota exhausted' },
      fizz(),
      { name: 'claude-1.json', provider: 'claude', label: 'Claude at work', disabled: true, status: 'disabled' },
      { name: 'claude-2.json', provider: 'claude', unavailable: true, status_message: 'ok' },
    ];

    const r = await call(app, 'GET', '/v1/accounts', cookie);
    expect(r.status).toBe(200);
    expect(r.body.accounts).toEqual([
      { id: 'antigravity-fizz@example.com.json', provider: 'antigravity', name: 'fizz@example.com', problem: null },
      { id: 'claude-1.json', provider: 'claude', name: 'Claude at work', problem: 'Turned off at the proxy.' },
      { id: 'claude-2.json', provider: 'claude', name: 'claude-2.json', problem: 'Not serving right now.' },
      { id: 'codex-pat@example.com.json', provider: 'codex', name: 'pat@example.com', problem: 'quota exhausted' },
    ]);
  });

  it('need the proxy and its management key', async () => {
    const owner = address('owner');
    const cookie = await account(owner, true);
    const owners = { WRITER_EMAILS: [owner], OWNER_EMAILS: [owner] };

    const none = await call(writer(owners, null), 'GET', '/v1/accounts', cookie);
    expect(none.status).toBe(503);
    expect(none.body.code).toBe('ai_offline');

    const { proxy } = await setUp();
    const keyless = await call(writer(owners, catalogOf(proxy, '')), 'GET', '/v1/accounts', cookie);
    expect(keyless.status).toBe(503);
    expect(keyless.body.code).toBe('no_management_key');

    const refused = await call(writer(owners, catalogOf(proxy, 'not-the-key')), 'GET', '/v1/accounts', cookie);
    expect(refused.status).toBe(502);
    expect(refused.body.code).toBe('management_refused');

    const gone = await fakeProxy(antigravity());
    await gone.close();
    const down = await call(writer(owners, catalogOf(gone)), 'GET', '/v1/accounts', cookie);
    expect(down.status).toBe(503);
    expect(down.body.code).toBe('ai_offline');
  });
});

describe('signing an account in', () => {
  it('hands out the sign-in page, waits, and shows the new account’s models at once', async () => {
    const { proxy, app, cookie } = await setUp();
    expect(await modelIds(app, cookie)).not.toContain('gpt-5.5-codex');

    const started = await send(app, 'POST', '/v1/accounts/sign-in', cookie, { provider: 'codex' });
    expect(started.status).toBe(200);
    expect(started.body).toEqual({ url: 'https://sign-in.example/codex?state=state-1', state: 'state-1' });
    // The proxy listens for the callback itself, so a browser on its machine needs nothing more.
    expect(proxy.signIns.get('state-1')).toMatchObject({ provider: 'codex', webui: true, status: 'wait' });

    const waiting = await call(app, 'GET', '/v1/accounts/sign-in/state-1', cookie);
    expect(waiting.body).toEqual({ status: 'wait', error: null });

    // The provider sends the browser back to the proxy, which keeps the account.
    proxy.served.credentials?.push({ name: 'codex-pat@example.com.json', provider: 'codex', email: 'pat@example.com' });
    proxy.served.models.push({ id: 'gpt-5.5-codex', owned_by: 'codex' });
    const signIn = proxy.signIns.get('state-1');
    if (signIn) {
      signIn.status = 'ok';
    }

    const done = await call(app, 'GET', '/v1/accounts/sign-in/state-1', cookie);
    expect(done.body).toEqual({ status: 'ok', error: null });
    expect(await modelIds(app, cookie)).toContain('gpt-5.5-codex');
  });

  it('says why a sign-in failed', async () => {
    const { proxy, app, cookie } = await setUp();
    const started = await send(app, 'POST', '/v1/accounts/sign-in', cookie, { provider: 'antigravity' });
    const signIn = proxy.signIns.get(started.body.state);
    if (signIn) {
      signIn.status = 'error';
      signIn.error = 'OAuth flow timed out';
    }

    const r = await call(app, 'GET', `/v1/accounts/sign-in/${started.body.state}`, cookie);
    expect(r.body).toEqual({ status: 'error', error: 'OAuth flow timed out' });
    const unknown = await call(app, 'GET', '/v1/accounts/sign-in/state-99', cookie);
    expect(unknown.body).toEqual({ status: 'error', error: 'unknown or expired state' });
  });

  it('only signs in the kinds of account settings offer', async () => {
    const { proxy, app, cookie } = await setUp();
    const r = await send(app, 'POST', '/v1/accounts/sign-in', cookie, { provider: 'kimi' });
    expect(r.status).toBe(400);
    expect(proxy.signIns.size).toBe(0);
  });

  it('takes the address the sign-in page ended on, when the browser isn’t on the proxy’s machine', async () => {
    const { proxy, app, cookie } = await setUp();
    const started = await send(app, 'POST', '/v1/accounts/sign-in', cookie, { provider: 'antigravity' });
    const state = started.body.state;
    const ended = `http://localhost:51121/oauth-callback?state=${state}&code=the-code&scope=email`;

    const r = await send(app, 'POST', `/v1/accounts/sign-in/${state}`, cookie, { address: ` ${ended} ` });
    expect(r.status).toBe(204);
    expect(proxy.signIns.get(state)?.callback).toEqual({ state, redirect_url: ended });
  });

  it('turns away an address that isn’t this sign-in’s, without bothering the proxy', async () => {
    const { proxy, app, cookie } = await setUp();
    const started = await send(app, 'POST', '/v1/accounts/sign-in', cookie, { provider: 'antigravity' });
    const state = started.body.state;
    const path = `/v1/accounts/sign-in/${state}`;

    const partial = await send(app, 'POST', path, cookie, { address: 'oauth-callback?code=the-code' });
    expect(partial.status).toBe(400);
    expect(partial.body.message).toBe('That isn’t a whole address. Copy all of it, from the address bar.');

    const other = await send(app, 'POST', path, cookie, { address: 'http://localhost:51121/oauth-callback?state=state-7&code=x' });
    expect(other.body.message).toBe('That address isn’t from this sign-in. Copy the address of the page this one ended on.');

    const empty = await send(app, 'POST', path, cookie, { address: `http://localhost:51121/oauth-callback?state=${state}` });
    expect(empty.body.message).toBe('That address has no sign-in in it. Copy the address of the page the sign-in ended on.');

    expect(proxy.signIns.get(state)?.callback).toBeUndefined();
  });

  it('stops waiting when the owner cancels', async () => {
    const { proxy, app, cookie } = await setUp();
    const started = await send(app, 'POST', '/v1/accounts/sign-in', cookie, { provider: 'claude' });
    const r = await call(app, 'DELETE', `/v1/accounts/sign-in/${started.body.state}`, cookie);
    expect(r.status).toBe(204);
    expect(proxy.signIns.has(started.body.state)).toBe(false);
  });
});

describe('signing an account out', () => {
  it('gives the accounts left, and its models go at once', async () => {
    const { app, cookie } = await setUp();
    expect(await modelIds(app, cookie)).toContain('gemini-3.8-flash-high');

    const r = await call(app, 'DELETE', `/v1/accounts/${encodeURIComponent(fizz().name)}`, cookie);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ accounts: [] });
    expect(await modelIds(app, cookie)).toEqual([]);
  });

  it('passes on the proxy’s refusal', async () => {
    const { app, cookie } = await setUp();
    const r = await call(app, 'DELETE', '/v1/accounts/nobody.json', cookie);
    expect(r.status).toBe(502);
    expect(r.body).toEqual({ code: 'proxy_refused', message: 'The proxy said no: file not found.' });
  });
});
