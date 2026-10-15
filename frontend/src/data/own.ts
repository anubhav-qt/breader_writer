import { OwnAi, SignIn, SignInStatus, type KeyProvider, type Provider } from '@writer/shared/protocol';
import { writer } from '../lib/api';

/*
 * A writer's own AI (step 9): the API keys they bring and the subscriptions they sign in, whose
 * models join the model picker's. Every writer but the owner sees it there, under the models.
 */

/** The server checks a key with its provider, or asks the writers' proxy, which can take a moment. */
const TIMEOUT = 20_000;

/** The providers a key can be for, in the order they're offered. */
export const KEY_PROVIDERS: KeyProvider[] = ['google', 'anthropic', 'openai'];

function keyPath(provider: KeyProvider): string {
  return `/v1/own/keys/${provider}`;
}

function signInPath(state: string): string {
  return `/v1/own/sign-in/${encodeURIComponent(state)}`;
}

export async function fetchOwn(): Promise<OwnAi> {
  const data = await writer.get<unknown>('/v1/own', TIMEOUT);
  return OwnAi.parse(data);
}

/** Keeps a key, once its provider takes it, in place of the one before. */
export async function saveKey(provider: KeyProvider, key: string): Promise<OwnAi> {
  const data = await writer.put<unknown>(keyPath(provider), { key }, TIMEOUT);
  return OwnAi.parse(data);
}

export async function removeKey(provider: KeyProvider): Promise<OwnAi> {
  const data = await writer.delete<unknown>(keyPath(provider), TIMEOUT);
  return OwnAi.parse(data);
}

/** Starts signing one of the writer's subscriptions in: the page to sign in on, and the sign-in to ask after. */
export async function startOwnSignIn(provider: Provider): Promise<SignIn> {
  const data = await writer.post<unknown>('/v1/own/sign-in', { provider }, TIMEOUT);
  return SignIn.parse(data);
}

export async function ownSignInStatus(state: string): Promise<SignInStatus> {
  const data = await writer.get<unknown>(signInPath(state), TIMEOUT);
  return SignInStatus.parse(data);
}

/** The address the sign-in page ended on, which can't load away from the writers' proxy. */
export async function sendOwnAddress(state: string, address: string): Promise<void> {
  await writer.post(signInPath(state), { address }, TIMEOUT);
}

export async function cancelOwnSignIn(state: string): Promise<void> {
  await writer.delete(signInPath(state), TIMEOUT);
}

/** Signs one of the writer's subscriptions out, and gives their own AI as it's left. */
export async function signOwnOut(name: string): Promise<OwnAi> {
  const data = await writer.delete<unknown>(`/v1/own/sign-ins/${encodeURIComponent(name)}`, TIMEOUT);
  return OwnAi.parse(data);
}
