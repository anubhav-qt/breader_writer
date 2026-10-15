import { useState, type FormEvent, type ReactNode } from 'react';
import type { AiAccount, Provider } from '@writer/shared/protocol';
import { PROVIDERS } from '../../data/accounts';
import { providerName } from '../../data/models';
import type { Accounts, Pending } from './useAccounts';
import { useInView } from './useInView';

/** The owner's part of the model picker: the AI accounts, and signing them in and out. */
export function AccountsSection({ accounts }: { accounts: Accounts }) {
  return (
    <>
      <div className="clbl">AI accounts</div>
      <div className="acct-verify">Every story here runs on these. Only you see them.</div>
      <Body accounts={accounts} />
      {accounts.message && <p className="acct-message" role="status">{accounts.message}</p>}
    </>
  );
}

function Body({ accounts }: { accounts: Accounts }) {
  const [leaving, setLeaving] = useState<AiAccount | null>(null);
  const { loaded, pending, busy } = accounts;

  if (loaded.state === 'waiting') {
    return <div className="acct-verify">Asking the proxy…</div>;
  }
  if (loaded.state === 'failed') {
    return (
      <div className="acct-verify">
        <span>{loaded.message}</span>
        <button type="button" className="login-link" onClick={() => void accounts.reload()}>Try again</button>
      </div>
    );
  }

  const signOutNow = async (account: AiAccount) => {
    await accounts.leave(account);
    setLeaving(null);
  };

  let action: ReactNode;
  if (leaving) {
    action = (
      <SignOut
        account={leaving}
        busy={busy}
        onCancel={() => setLeaving(null)}
        onConfirm={() => void signOutNow(leaving)}
      />
    );
  } else if (pending) {
    action = (
      <Waiting
        key={pending.state}
        pending={pending}
        busy={busy}
        onSend={(address) => void accounts.send(address)}
        onCancel={() => void accounts.cancel()}
      />
    );
  } else {
    action = <SignInLinks busy={busy} onStart={(provider) => void accounts.start(provider)} />;
  }

  return (
    <>
      <div className="pick-accounts">
        {loaded.accounts.length === 0 && <div className="acct-verify">None signed in yet.</div>}
        {loaded.accounts.map((account) => (
          <AccountRow key={account.id} account={account} busy={busy} onSignOut={() => setLeaving(account)} />
        ))}
      </div>
      {action}
    </>
  );
}

export function AccountRow({ account, busy, onSignOut }: { account: AiAccount; busy: boolean; onSignOut: () => void }) {
  return (
    <div className="pick-account">
      <span>
        {providerName(account.provider)}
        <small>{account.name}</small>
        {account.problem && <small>{account.problem}</small>}
      </span>
      <button type="button" className="login-link" disabled={busy} onClick={onSignOut}>Sign out</button>
    </div>
  );
}

interface SignOutProps {
  account: AiAccount;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function SignOut({ account, busy, onCancel, onConfirm }: SignOutProps) {
  const ref = useInView<HTMLDivElement>();
  let label = 'Sign out';
  if (busy) {
    label = 'Signing out…';
  }
  return (
    <div className="acct-confirm" ref={ref}>
      <p>Sign {account.name} out? Its models go with it until it’s signed in again.</p>
      <div className="add-actions">
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={onConfirm}>{label}</button>
      </div>
    </div>
  );
}

interface WaitingProps {
  pending: Pending;
  busy: boolean;
  onSend: (address: string) => void;
  onCancel: () => void;
}

/**
 * A sign-in under way. On the proxy's own machine it finishes by itself; anywhere else its last
 * page can't load, so its address is pasted here.
 */
export function Waiting({ pending, busy, onSend, onCancel }: WaitingProps) {
  const ref = useInView<HTMLFormElement>();
  const [address, setAddress] = useState('');
  const given = address.trim();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (given) {
      onSend(given);
    }
  };

  return (
    <form className="pick-wait" ref={ref} onSubmit={submit}>
      <p>
        Signing in to {providerName(pending.provider)}: finish in the tab that opened.{' '}
        <a className="login-link" href={pending.url} target="_blank" rel="noopener noreferrer">Open it again</a>
      </p>
      <p>If it ends on a page that won’t load, paste that page’s address here.</p>
      <input
        className="add-input login-input"
        type="url"
        inputMode="url"
        placeholder="http://localhost:…"
        aria-label="The address the sign-in ended on"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
      />
      <div className="add-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={!given || busy}>Done</button>
      </div>
    </form>
  );
}

export function SignInLinks({ busy, onStart }: { busy: boolean; onStart: (provider: Provider) => void }) {
  return (
    <div className="pick-signin">
      <span>Sign in</span>
      {PROVIDERS.map((provider) => (
        <button key={provider} type="button" className="login-link" disabled={busy} onClick={() => onStart(provider)}>
          {providerName(provider)}
        </button>
      ))}
    </div>
  );
}
