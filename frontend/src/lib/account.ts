import { useEffect, useSyncExternalStore } from 'react';
import type { Account } from '@breader/shared/protocol';
import { api, ApiError, OfflineError } from './api';
import { readLocal } from './store';

/*
 * Logging in (backend design §4). The server's Better Auth session, at /v1/auth/*, says who the
 * reader is. The library itself still syncs with its key: after a login, data/sync.ts enterAccount
 * swaps this browser to the account's library and keeps that library's key like any other.
 *
 * The account is remembered here too, so the header shows it while the server can't be reached.
 */

export interface AccountState {
  /** 'unknown' until the server has answered, or while it can't be reached and nothing is remembered. */
  status: 'unknown' | 'out' | 'in';
  user: Account | null;
  /** The server can log in with Google. */
  google: boolean;
}

const REMEMBERED = 'breader.account.v1';

let state: AccountState = (() => {
  const user = readLocal<Account | null>(REMEMBERED, null);
  return { status: user ? 'in' : 'unknown', user, google: false };
})();
const subscribers = new Set<() => void>();

function set(next: Partial<AccountState>) {
  state = { ...state, ...next };
  try {
    if (state.user) localStorage.setItem(REMEMBERED, JSON.stringify(state.user));
    else localStorage.removeItem(REMEMBERED);
  } catch { /* storage blocked */ }
  subscribers.forEach((s) => s());
}

const signedIn = (user: Account | null) => set({ status: user ? 'in' : 'out', user });
/** A user as Better Auth sends it, with more fields than Breader keeps. */
type User = { email: string; name: string; emailVerified: boolean };
const toAccount = (u: User): Account => ({ email: u.email, name: u.name, emailVerified: u.emailVerified });

/** Asks the server who is logged in. Keeps what it knew if the server can't be reached. */
export async function refreshAccount(): Promise<AccountState> {
  try {
    const [session, options] = await Promise.all([
      api.get<{ user: User } | null>('/v1/auth/get-session'),
      api.get<{ google: boolean }>('/v1/login-options').catch(() => ({ google: state.google })),
    ]);
    set({ google: options.google });
    signedIn(session?.user ? toAccount(session.user) : null);
  } catch (e) {
    if (!(e instanceof OfflineError)) console.warn('Couldn’t check the login:', e);
  }
  return state;
}

const auth = <T>(path: string, body: unknown) => api.post<T>(`/v1/auth${path}`, body, 10_000);

export async function signUp(email: string, password: string) {
  const r = await auth<{ user: User }>('/sign-up/email', {
    email,
    password,
    name: email.split('@')[0],
  });
  signedIn(toAccount(r.user));
}

export async function logIn(email: string, password: string) {
  const r = await auth<{ user: User }>('/sign-in/email', { email, password, rememberMe: true });
  signedIn(toAccount(r.user));
}

/** Leaves for Google; it sends the reader back to /?login=google, or /?login=failed. */
export async function logInWithGoogle() {
  const back = `${location.origin}/`;
  const r = await auth<{ url: string }>('/sign-in/social', {
    provider: 'google',
    callbackURL: `${back}?login=google`,
    errorCallbackURL: `${back}?login=failed`,
  });
  location.assign(r.url);
}

export const requestReset = (email: string) => auth('/request-password-reset', { email, redirectTo: `${location.origin}/` });

export const resetPassword = (token: string, newPassword: string) => auth('/reset-password', { token, newPassword });

/** Confirms the email from its link. The link also logs this browser in if it wasn't. */
export async function verifyEmail(token: string) {
  await api.get(`/v1/auth/verify-email?token=${encodeURIComponent(token)}`, 10_000);
  return refreshAccount();
}

export async function sendVerification() {
  if (!state.user) return;
  await auth('/send-verification-email', { email: state.user.email, callbackURL: `${location.origin}/` });
}

/** Ends the login on the server. The caller clears the library from this browser. */
export async function logOut() {
  await auth('/sign-out', {});
  signedIn(null);
}

const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'That email and password don’t match. Check both, or reset your password.',
  USER_ALREADY_EXISTS: 'There’s already an account for this email. Log in instead.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'There’s already an account for this email. Log in instead.',
  INVALID_EMAIL: 'That doesn’t look like an email address.',
  PASSWORD_TOO_SHORT: 'Use at least 8 characters for your password.',
  PASSWORD_TOO_LONG: 'That password is too long. Use 128 characters or fewer.',
  INVALID_TOKEN: 'This link has expired or was already used. Ask for a new one.',
  TOKEN_EXPIRED: 'This link has expired. Ask for a new one.',
};

/** What to tell the reader when a login step fails. */
export function loginError(e: unknown): string {
  if (e instanceof OfflineError) return e.message;
  if (e instanceof ApiError) {
    if (e.status === 429) return 'Too many tries. Wait a few minutes, then try again.';
    return MESSAGES[e.code] ?? e.message;
  }
  return e instanceof Error ? e.message : 'Something went wrong. Try again.';
}

const subscribe = (fn: () => void) => {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
};
const get = () => state;
let checked = false;

export function useAccount(): AccountState {
  useEffect(() => {
    if (checked) return;
    checked = true;
    void refreshAccount();
  }, []);
  return useSyncExternalStore(subscribe, get);
}
