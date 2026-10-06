import { z } from 'zod';
import type { AiAccount, Provider, SignIn, SignInStatus } from '@writer/shared/protocol';
import { manage, type Proxy } from './proxy.ts';

/*
 * The AI accounts signed in to the proxy, which the owner signs in and out from settings through
 * its management API. Signing in is the proxy's own: it hands out the provider's sign-in page,
 * which sends the browser back to a callback on the proxy's machine (localhost), and the proxy
 * listens there while the sign-in waits. When the browser is on another machine that page can't
 * load, so the owner pastes its address in instead, and it's passed on to the proxy.
 */

/** A signed in account, as the proxy lists it (its credential file). */
const Credential = z.object({
  name: z.string(),
  provider: z.string().default(''),
  label: z.string().default(''),
  email: z.string().optional(),
  status: z.string().default(''),
  status_message: z.string().default(''),
  disabled: z.boolean().default(false),
  unavailable: z.boolean().default(false),
});
type Credential = z.infer<typeof Credential>;

const Credentials = z.object({
  files: z.array(Credential).default([]),
});

const Started = z.object({
  url: z.string(),
  state: z.string(),
});

const Status = z.object({
  status: z.enum(['wait', 'ok', 'error']),
  error: z.string().optional(),
});

/** What the proxy answers when it has done what was asked. */
const Done = z.looseObject({});

/** Why an account can't serve right now, or null while it can. */
function problemOf(credential: Credential): string | null {
  if (credential.disabled || credential.status === 'disabled') {
    return 'Turned off at the proxy.';
  }
  const failing = credential.unavailable || credential.status === 'error';
  if (!failing) {
    return null;
  }
  const message = credential.status_message.trim();
  if (message && message !== 'ok') {
    return message;
  }
  return 'Not serving right now.';
}

function accountOf(credential: Credential): AiAccount {
  let name = credential.name;
  if (credential.email) {
    name = credential.email;
  } else if (credential.label) {
    name = credential.label;
  }
  return {
    id: credential.name,
    provider: credential.provider,
    name,
    problem: problemOf(credential),
  };
}

/** Every account signed in to the proxy, by kind and then by who. */
export async function listAccounts(proxy: Proxy): Promise<AiAccount[]> {
  const body = await manage(proxy, '/credentials', Credentials);
  const accounts = body.files.map(accountOf);
  return accounts.sort((one, other) => {
    const byProvider = one.provider.localeCompare(other.provider);
    if (byProvider !== 0) {
      return byProvider;
    }
    return one.name.localeCompare(other.name);
  });
}

/** Signs an account out: the proxy forgets it, and its models go. */
export async function signOut(proxy: Proxy, id: string): Promise<void> {
  await manage(proxy, `/credentials?name=${encodeURIComponent(id)}`, Done, { method: 'DELETE' });
}

/**
 * Starts signing an account in: the page to sign in on, and the sign-in's state. `is_webui` has
 * the proxy listen for the callback on its own machine while it waits, the way its own settings
 * page does.
 */
export async function startSignIn(proxy: Proxy, provider: Provider): Promise<SignIn> {
  const path = `/oauth/auth-url?provider=${provider}&is_webui=true`;
  const body = await manage(proxy, path, Started);
  return { url: body.url, state: body.state };
}

/** How a sign-in stands: waiting, signed in, or failed and why. */
export async function signInStatus(proxy: Proxy, state: string): Promise<SignInStatus> {
  const path = `/oauth/status?state=${encodeURIComponent(state)}`;
  const body = await manage(proxy, path, Status);
  if (body.status === 'error') {
    return { status: 'error', error: body.error ?? 'The sign-in failed.' };
  }
  return { status: body.status, error: null };
}

/**
 * Why an address can't be the one this sign-in ended on, or null when it can: a whole address,
 * with this sign-in's state in it and the provider's code (or its error).
 */
export function addressProblem(address: string, state: string): string | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return 'That isn’t a whole address. Copy all of it, from the address bar.';
  }
  if (url.searchParams.get('state') !== state) {
    return 'That address isn’t from this sign-in. Copy the address of the page this one ended on.';
  }
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  if (!code && !error) {
    return 'That address has no sign-in in it. Copy the address of the page the sign-in ended on.';
  }
  return null;
}

/** Hands the proxy the address the sign-in page ended on, which carries what it waits for. */
export async function finishSignIn(proxy: Proxy, state: string, address: string): Promise<void> {
  const body = { state, redirect_url: address };
  await manage(proxy, '/oauth/callback', Done, { method: 'POST', body });
}

/** Stops waiting for a sign-in. */
export async function cancelSignIn(proxy: Proxy, state: string): Promise<void> {
  const path = `/oauth/session?state=${encodeURIComponent(state)}`;
  await manage(proxy, path, Done, { method: 'DELETE' });
}
