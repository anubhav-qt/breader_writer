import { useEffect, useSyncExternalStore } from 'react';
import { Me } from '@writer/shared/protocol';
import { ApiError, OfflineError, breader, writer } from './api';
import { readLocal, writeLocal } from './store';

/*
 * Who is logged in, and whether they may write. Logging in is breader's: its Better Auth, at
 * breader's /v1/auth/*, sets one login for breader and the writer both. The writer's server reads
 * that login and answers /v1/me with the account and its access.
 *
 * What it said last is remembered, so the header still shows the account while the writer is
 * offline. The writer shares breader.site's storage with breader, so its keys start with writer.
 */

export interface AccountState {
  /** What the writer's server last said, or null if it never has in this browser. */
  me: Me | null;
  /** Whether the writer's server answered when last asked. */
  server: 'checking' | 'up' | 'down';
  /** Breader can log in with Google. */
  google: boolean;
}

const REMEMBERED = 'writer.me.v1';
/** While the writer's server is down, it's asked again this often. */
const RETRY_EVERY = 60_000;

function remembered(): Me | null {
  const saved = Me.safeParse(readLocal<unknown>(REMEMBERED, null));
  if (saved.success) return saved.data;
  return null;
}

let state: AccountState = { me: remembered(), server: 'checking', google: false };
const subscribers = new Set<() => void>();

function set(next: Partial<AccountState>) {
  state = { ...state, ...next };
  subscribers.forEach((s) => s());
}

function remember(me: Me) {
  writeLocal(REMEMBERED, me);
  set({ me });
}

/** Asks the writer's server who is logged in and whether they may write. */
export async function refreshMe(): Promise<void> {
  try {
    const data = await writer.get<unknown>('/v1/me');
    remember(Me.parse(data));
    set({ server: 'up' });
  } catch (e) {
    if (!(e instanceof OfflineError)) console.warn('Couldn’t ask the writer who is logged in:', e);
    set({ server: 'down' });
  }
}

async function checkGoogle() {
  try {
    const options = await breader.get<{ google: boolean }>('/v1/login-options');
    set({ google: options.google === true });
  } catch {
    // Without an answer, the login dialog offers email and password only.
  }
}

const auth = <T>(path: string, body: unknown) => breader.post<T>(`/v1/auth${path}`, body, 10_000);

export async function signUp(email: string, password: string) {
  await auth('/sign-up/email', { email, password, name: email.split('@')[0] });
  await refreshMe();
}

export async function logIn(email: string, password: string) {
  await auth('/sign-in/email', { email, password, rememberMe: true });
  await refreshMe();
}

/** Leaves for Google; it sends the owner back to the writer with ?login=google, or ?login=failed. */
export async function logInWithGoogle() {
  const back = `${location.origin}${import.meta.env.BASE_URL}`;
  const r = await auth<{ url: string }>('/sign-in/social', {
    provider: 'google',
    callbackURL: `${back}?login=google`,
    errorCallbackURL: `${back}?login=failed`,
  });
  location.assign(r.url);
}

/** The link in the email opens breader, which has the page for choosing a new password. */
export const requestReset = (email: string) => auth('/request-password-reset', { email, redirectTo: `${location.origin}/` });

export async function sendVerification() {
  const email = state.me?.account?.email;
  if (!email) return;
  await auth('/send-verification-email', { email, callbackURL: `${location.origin}/` });
}

/** Ends the login. It's breader's login too, so this logs out of breader as well. */
export async function logOut() {
  await auth('/sign-out', {});
  remember({ account: null, access: 'logged_out', owner: false });
}

const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'That email and password don’t match. Check both, or reset your password.',
  USER_ALREADY_EXISTS: 'There’s already an account for this email. Log in instead.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'There’s already an account for this email. Log in instead.',
  INVALID_EMAIL: 'That doesn’t look like an email address.',
  PASSWORD_TOO_SHORT: 'Use at least 8 characters for your password.',
  PASSWORD_TOO_LONG: 'That password is too long. Use 128 characters or fewer.',
};

/** What to tell the owner when a login step fails. */
export function loginError(e: unknown): string {
  if (e instanceof OfflineError) return e.message;
  if (e instanceof ApiError) {
    if (e.status === 429) return 'Too many tries. Wait a few minutes, then try again.';
    return MESSAGES[e.code] ?? e.message;
  }
  if (e instanceof Error) return e.message;
  return 'Something went wrong. Try again.';
}

const subscribe = (fn: () => void) => {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
};
const get = () => state;
let checked = false;

export function useAccount(): AccountState {
  const account = useSyncExternalStore(subscribe, get);

  useEffect(() => {
    if (checked) return;
    checked = true;
    void refreshMe();
    void checkGoogle();
  }, []);

  // The writer comes back by itself when its server does.
  useEffect(() => {
    if (account.server !== 'down') return;
    const timer = window.setInterval(() => void refreshMe(), RETRY_EVERY);
    return () => window.clearInterval(timer);
  }, [account.server]);

  return account;
}
