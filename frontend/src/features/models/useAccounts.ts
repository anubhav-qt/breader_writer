import { useCallback, useEffect, useState } from 'react';
import type { AiAccount, Provider, SignInStatus } from '@writer/shared/protocol';
import { cancelSignIn, fetchAccounts, sendAddress, signInStatus, signOut, startSignIn } from '../../data/accounts';
import { providerName } from '../../data/models';
import { failureText } from '../../lib/api';

/** How often a waiting sign-in is asked after. */
const POLL_MS = 2000;

/** The accounts as last heard, or why there are none. */
export type Loaded =
  | { state: 'waiting' }
  | { state: 'failed'; message: string }
  | { state: 'ready'; accounts: AiAccount[] };

/** A sign-in started and not finished yet. */
export interface Pending {
  provider: Provider;
  state: string;
  /** The page to sign in on, to open again. */
  url: string;
}

export interface Accounts {
  loaded: Loaded;
  pending: Pending | null;
  message: string | null;
  busy: boolean;
  reload: () => Promise<void>;
  start: (provider: Provider) => Promise<void>;
  send: (address: string) => Promise<void>;
  cancel: () => Promise<void>;
  leave: (account: AiAccount) => Promise<void>;
}

/**
 * The owner's AI accounts, kept by the model picker rather than its menu, so a sign-in goes on
 * waiting while the menu is closed. `onChanged` hears when one is signed in or out, since the
 * models come and go with them.
 */
export function useAccounts(owner: boolean, open: boolean, onChanged: () => Promise<void>): Accounts {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'waiting' });
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const accounts = await fetchAccounts();
      setLoaded({ state: 'ready', accounts });
    } catch (e) {
      setLoaded({ state: 'failed', message: failureText(e) });
    }
  }, []);

  // Opening the menu asks again, as it does for the models.
  useEffect(() => {
    if (!open) {
      setMessage(null);
      return;
    }
    if (owner) {
      void reload();
    }
  }, [owner, open, reload]);

  // A waiting sign-in is asked after every couple of seconds, until it's in or has failed.
  useEffect(() => {
    if (!pending) {
      return;
    }
    let stopped = false;
    let timer = 0;
    const ask = async () => {
      let status: SignInStatus | null = null;
      try {
        status = await signInStatus(pending.state);
      } catch {
        // No answer this time; ask again.
      }
      if (stopped) {
        return;
      }
      if (!status || status.status === 'wait') {
        timer = window.setTimeout(() => void ask(), POLL_MS);
        return;
      }
      setPending(null);
      if (status.status === 'ok') {
        setMessage(`Signed in to ${providerName(pending.provider)}.`);
        void reload();
        void onChanged();
        return;
      }
      setMessage(`The sign-in didn’t finish: ${status.error ?? 'the proxy didn’t say why'}.`);
    };
    timer = window.setTimeout(() => void ask(), POLL_MS);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [pending, reload, onChanged]);

  const start = async (provider: Provider) => {
    setMessage(null);
    setBusy(true);
    // Opened while the click still counts, so the browser allows it, and sent to the sign-in page
    // once the proxy says where. That page gets no hold on this one.
    const tab = window.open('', '_blank');
    if (tab) {
      tab.opener = null;
    }
    try {
      const signIn = await startSignIn(provider);
      if (tab) {
        tab.location.href = signIn.url;
      }
      setPending({ provider, state: signIn.state, url: signIn.url });
    } catch (e) {
      if (tab) {
        tab.close();
      }
      setMessage(failureText(e));
    } finally {
      setBusy(false);
    }
  };

  const send = async (address: string) => {
    if (!pending) {
      return;
    }
    setMessage(null);
    setBusy(true);
    try {
      await sendAddress(pending.state, address);
      setMessage('Got it. Finishing the sign-in…');
    } catch (e) {
      setMessage(failureText(e));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!pending) {
      return;
    }
    const waiting = pending;
    setPending(null);
    setMessage(null);
    try {
      await cancelSignIn(waiting.state);
    } catch {
      // Left alone, the proxy gives up on it after a few minutes.
    }
  };

  const leave = async (account: AiAccount) => {
    setMessage(null);
    setBusy(true);
    try {
      const accounts = await signOut(account.id);
      setLoaded({ state: 'ready', accounts });
      setMessage(`Signed ${account.name} out.`);
      void onChanged();
    } catch (e) {
      setMessage(failureText(e));
    } finally {
      setBusy(false);
    }
  };

  return { loaded, pending, message, busy, reload, start, send, cancel, leave };
}
