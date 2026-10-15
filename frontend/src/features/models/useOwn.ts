import { useCallback, useEffect, useState } from 'react';
import type { AiAccount, KeyProvider, OwnAi, Provider } from '@writer/shared/protocol';
import { keyProviderName } from '../../data/models';
import { cancelOwnSignIn, fetchOwn, ownSignInStatus, removeKey, saveKey, sendOwnAddress, signOwnOut, startOwnSignIn } from '../../data/own';
import { failureText } from '../../lib/api';
import { useSignIn, type Pending, type SignInCalls } from './useSignIn';

/** The writer's own AI as last heard, or why it isn't known. */
export type OwnLoaded =
  | { state: 'waiting' }
  | { state: 'failed'; message: string }
  | { state: 'ready'; own: OwnAi };

export interface Own {
  loaded: OwnLoaded;
  pending: Pending | null;
  message: string | null;
  busy: boolean;
  reload: () => Promise<void>;
  /** Answers whether the key was kept. */
  saveKey: (provider: KeyProvider, key: string) => Promise<boolean>;
  removeKey: (provider: KeyProvider) => Promise<void>;
  start: (provider: Provider) => Promise<void>;
  send: (address: string) => Promise<void>;
  cancel: () => Promise<void>;
  leave: (signIn: AiAccount) => Promise<void>;
}

/** Signing in to the writers' proxy, where each writer's sign-ins serve only them. */
const OWN_SIGN_IN: SignInCalls = {
  start: startOwnSignIn,
  status: ownSignInStatus,
  send: sendOwnAddress,
  cancel: cancelOwnSignIn,
};

/**
 * A writer's own AI, kept by the model picker as the owner's accounts are, so a sign-in goes on
 * waiting while the menu is closed. `onChanged` hears when a key or a sign-in comes or goes,
 * since the models come and go with them.
 */
export function useOwn(writer: boolean, open: boolean, onChanged: () => Promise<void>): Own {
  const [loaded, setLoaded] = useState<OwnLoaded>({ state: 'waiting' });
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const own = await fetchOwn();
      setLoaded({ state: 'ready', own });
    } catch (e) {
      setLoaded({ state: 'failed', message: failureText(e) });
    }
  }, []);

  const signedIn = useCallback(() => {
    void reload();
    void onChanged();
  }, [reload, onChanged]);

  const signIn = useSignIn(OWN_SIGN_IN, { say: setMessage, setBusy, onIn: signedIn });

  // Opening the menu asks again, as it does for the models.
  useEffect(() => {
    if (!open) {
      setMessage(null);
      return;
    }
    if (writer) {
      void reload();
    }
  }, [writer, open, reload]);

  const keep = async (provider: KeyProvider, key: string): Promise<boolean> => {
    setMessage(null);
    setBusy(true);
    try {
      const own = await saveKey(provider, key);
      setLoaded({ state: 'ready', own });
      setMessage(`Your ${keyProviderName(provider)} key is in. Its models are in the list.`);
      void onChanged();
      return true;
    } catch (e) {
      setMessage(failureText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const drop = async (provider: KeyProvider) => {
    setMessage(null);
    setBusy(true);
    try {
      const own = await removeKey(provider);
      setLoaded({ state: 'ready', own });
      setMessage(`Your ${keyProviderName(provider)} key is gone.`);
      void onChanged();
    } catch (e) {
      setMessage(failureText(e));
    } finally {
      setBusy(false);
    }
  };

  const leave = async (account: AiAccount) => {
    setMessage(null);
    setBusy(true);
    try {
      const own = await signOwnOut(account.id);
      setLoaded({ state: 'ready', own });
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
    saveKey: keep,
    removeKey: drop,
    start: signIn.start,
    send: signIn.send,
    cancel: signIn.cancel,
    leave,
  };
}
