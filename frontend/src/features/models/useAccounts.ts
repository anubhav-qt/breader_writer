import { useCallback, useEffect, useState } from 'react';
import type { AiAccount, Provider } from '@writer/shared/protocol';
import { cancelSignIn, fetchAccounts, sendAddress, signInStatus, signOut, startSignIn } from '../../data/accounts';
import { failureText } from '../../lib/api';
import { useSignIn, type Pending, type SignInCalls } from './useSignIn';

export type { Pending } from './useSignIn';

/** The accounts as last heard, or why there are none. */
export type Loaded =
  | { state: 'waiting' }
  | { state: 'failed'; message: string }
  | { state: 'ready'; accounts: AiAccount[] };

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

/** Signing in to the house's proxy, which every story of the owner's runs on. */
const HOUSE_SIGN_IN: SignInCalls = {
  start: startSignIn,
  status: signInStatus,
  send: sendAddress,
  cancel: cancelSignIn,
};

/**
 * The owner's AI accounts, kept by the model picker rather than its menu, so a sign-in goes on
 * waiting while the menu is closed. `onChanged` hears when one is signed in or out, since the
 * models come and go with them.
 */
export function useAccounts(owner: boolean, open: boolean, onChanged: () => Promise<void>): Accounts {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'waiting' });
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

  const signedIn = useCallback(() => {
    void reload();
    void onChanged();
  }, [reload, onChanged]);

  const signIn = useSignIn(HOUSE_SIGN_IN, { say: setMessage, setBusy, onIn: signedIn });

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

  return {
    loaded,
    pending: signIn.pending,
    message,
    busy,
    reload,
    start: signIn.start,
    send: signIn.send,
    cancel: signIn.cancel,
    leave,
  };
}
