import { useEffect, useState } from 'react';
import type { Provider, SignIn, SignInStatus } from '@writer/shared/protocol';
import { providerName } from '../../data/models';
import { ApiError, failureText } from '../../lib/api';

/** How often a waiting sign-in is asked after. */
const POLL_MS = 2000;

/** A sign-in started and not finished yet. */
export interface Pending {
  provider: Provider;
  state: string;
  /** The page to sign in on, to open again. */
  url: string;
}

/** Where a sign-in goes: the owner's AI accounts, or a writer's own subscriptions. */
export interface SignInCalls {
  start: (provider: Provider) => Promise<SignIn>;
  status: (state: string) => Promise<SignInStatus>;
  send: (state: string, address: string) => Promise<void>;
  cancel: (state: string) => Promise<void>;
}

export interface SignInFlow {
  pending: Pending | null;
  start: (provider: Provider) => Promise<void>;
  send: (address: string) => Promise<void>;
  cancel: () => Promise<void>;
}

/** What the part holding a sign-in hears from it. Each must keep its identity across renders. */
interface Listeners {
  say: (message: string | null) => void;
  setBusy: (busy: boolean) => void;
  /** It's in: what it signed in serves models now. */
  onIn: () => void;
}

/**
 * A sign-in, from opening the provider's page in a new tab to the proxy saying it's in. It's
 * asked after every couple of seconds while it waits, for as long as the part holding it lives.
 */
export function useSignIn(calls: SignInCalls, { say, setBusy, onIn }: Listeners): SignInFlow {
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    if (!pending) {
      return;
    }
    let stopped = false;
    let timer = 0;
    const ask = async () => {
      let status: SignInStatus | null = null;
      try {
        status = await calls.status(pending.state);
      } catch (e) {
        // The server no longer knows it: it waited too long. Anything else, ask again.
        if (e instanceof ApiError && e.status === 404) {
          status = { status: 'error', error: 'it waited too long, so start it again' };
        }
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
        say(`Signed in to ${providerName(pending.provider)}.`);
        onIn();
        return;
      }
      say(`The sign-in didn’t finish: ${status.error ?? 'the proxy didn’t say why'}.`);
    };
    timer = window.setTimeout(() => void ask(), POLL_MS);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [pending, calls, say, onIn]);

  const start = async (provider: Provider) => {
    say(null);
    setBusy(true);
    // Opened while the click still counts, so the browser allows it, and sent to the sign-in page
    // once the proxy says where. That page gets no hold on this one.
    const tab = window.open('', '_blank');
    if (tab) {
      tab.opener = null;
    }
    try {
      const signIn = await calls.start(provider);
      if (tab) {
        tab.location.href = signIn.url;
      }
      setPending({ provider, state: signIn.state, url: signIn.url });
    } catch (e) {
      if (tab) {
        tab.close();
      }
      say(failureText(e));
    } finally {
      setBusy(false);
    }
  };

  const send = async (address: string) => {
    if (!pending) {
      return;
    }
    say(null);
    setBusy(true);
    try {
      await calls.send(pending.state, address);
      say('Got it. Finishing the sign-in…');
    } catch (e) {
      say(failureText(e));
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
    say(null);
    try {
      await calls.cancel(waiting.state);
    } catch {
      // Left alone, the proxy gives up on it after a few minutes.
    }
  };

  return { pending, start, send, cancel };
}
