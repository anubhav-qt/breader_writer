import { AiAccounts, SignIn, SignInStatus, type AiAccount, type Provider } from '@writer/shared/protocol';
import { writer } from '../lib/api';

/*
 * The AI accounts signed in to Procreator's proxy, which every story runs on. Only the owner sees
 * them, in the model picker, and signs them in and out there.
 */

/** The server asks the proxy, which can take a moment. */
const TIMEOUT = 20_000;

/** The kinds of account settings sign in, in the order they're offered. */
export const PROVIDERS: Provider[] = ['antigravity', 'codex', 'claude'];

function signInPath(state: string): string {
  return `/v1/accounts/sign-in/${encodeURIComponent(state)}`;
}

export async function fetchAccounts(): Promise<AiAccount[]> {
  const data = await writer.get<unknown>('/v1/accounts', TIMEOUT);
  return AiAccounts.parse(data).accounts;
}

/** Starts a sign-in: the page to sign in on, and the sign-in to ask after. */
export async function startSignIn(provider: Provider): Promise<SignIn> {
  const data = await writer.post<unknown>('/v1/accounts/sign-in', { provider }, TIMEOUT);
  return SignIn.parse(data);
}

export async function signInStatus(state: string): Promise<SignInStatus> {
  const data = await writer.get<unknown>(signInPath(state), TIMEOUT);
  return SignInStatus.parse(data);
}

/** The address the sign-in page ended on, for when it couldn't load. */
export async function sendAddress(state: string, address: string): Promise<void> {
  await writer.post(signInPath(state), { address }, TIMEOUT);
}

export async function cancelSignIn(state: string): Promise<void> {
  await writer.delete(signInPath(state), TIMEOUT);
}

/** Signs an account out, and gives the accounts left. */
export async function signOut(id: string): Promise<AiAccount[]> {
  const data = await writer.delete<unknown>(`/v1/accounts/${encodeURIComponent(id)}`, TIMEOUT);
  return AiAccounts.parse(data).accounts;
}
