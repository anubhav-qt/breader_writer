import { useState, type FormEvent, type ReactNode } from 'react';
import type { AiAccount, HouseStanding, KeyProvider, OwnKey } from '@writer/shared/protocol';
import { keyProviderName } from '../../data/models';
import { KEY_PROVIDERS } from '../../data/own';
import { AccountRow, SignInLinks, SignOut, Waiting } from './Accounts';
import { useInView } from './useInView';
import type { Own } from './useOwn';

/** What the house writes for the writer, said over their own AI. */
const HOUSE_NOTES: Record<HouseStanding, string> = {
  always: 'Bring your own AI too, if you like: a key, or a subscription you already have. Its models join the list, and only your stories use it.',
  first_chapter: 'Your first chapter is on the house. To go on after it, bring your own AI: a key, or a subscription you already have. Only your stories use it.',
  used: 'Your first chapter was on the house. To go on, bring your own AI: a key, or a subscription you already have. Only your stories use it.',
};

/** Where each provider's keys are made. */
const KEY_WHERE: Record<KeyProvider, string> = {
  google: 'Google AI Studio',
  anthropic: 'the Claude Console',
  openai: 'the OpenAI platform',
};

/** Every writer's part of the model picker but the owner's: their own keys and subscriptions. */
export function YourAiSection({ house, own }: { house: HouseStanding; own: Own }) {
  return (
    <>
      <div className="clbl">Your AI</div>
      <div className="acct-verify">{HOUSE_NOTES[house]}</div>
      <Body own={own} />
      {own.message && <p className="acct-message" role="status">{own.message}</p>}
    </>
  );
}

/** What's open at the section's end, one thing at a time. */
type Opened =
  | { kind: 'nothing' }
  | { kind: 'adding'; provider: KeyProvider }
  | { kind: 'removing'; ownKey: OwnKey }
  | { kind: 'leaving'; signIn: AiAccount };

function Body({ own }: { own: Own }) {
  const [opened, setOpened] = useState<Opened>({ kind: 'nothing' });
  const { loaded, pending, busy } = own;

  if (loaded.state === 'waiting') {
    return <div className="acct-verify">Asking after your AI…</div>;
  }
  if (loaded.state === 'failed') {
    return (
      <div className="acct-verify">
        <span>{loaded.message}</span>
        <button type="button" className="login-link" onClick={() => void own.reload()}>Try again</button>
      </div>
    );
  }
  const { keys, signIns, keysHere, signInsHere } = loaded.own;
  if (!keysHere && !signInsHere) {
    return <div className="acct-verify">This server doesn’t take writers’ own AI yet.</div>;
  }

  const close = () => setOpened({ kind: 'nothing' });

  const keepKey = async (provider: KeyProvider, key: string) => {
    const kept = await own.saveKey(provider, key);
    if (kept) {
      close();
    }
  };

  const removeNow = async (ownKey: OwnKey) => {
    await own.removeKey(ownKey.provider);
    close();
  };

  const signOutNow = async (signIn: AiAccount) => {
    await own.leave(signIn);
    close();
  };

  let action: ReactNode;
  if (opened.kind === 'adding') {
    const had = keys.find((ownKey) => ownKey.provider === opened.provider);
    action = (
      <AddKey
        key={opened.provider}
        provider={opened.provider}
        had={had ?? null}
        busy={busy}
        onCancel={close}
        onSave={(key) => void keepKey(opened.provider, key)}
      />
    );
  } else if (opened.kind === 'removing') {
    action = (
      <RemoveKey
        ownKey={opened.ownKey}
        busy={busy}
        onCancel={close}
        onConfirm={() => void removeNow(opened.ownKey)}
      />
    );
  } else if (opened.kind === 'leaving') {
    action = (
      <SignOut
        account={opened.signIn}
        busy={busy}
        onCancel={close}
        onConfirm={() => void signOutNow(opened.signIn)}
      />
    );
  } else if (pending) {
    action = (
      <Waiting
        key={pending.state}
        pending={pending}
        busy={busy}
        onSend={(address) => void own.send(address)}
        onCancel={() => void own.cancel()}
      />
    );
  } else {
    action = (
      <>
        {keysHere && <KeyLinks busy={busy} onAdd={(provider) => setOpened({ kind: 'adding', provider })} />}
        {signInsHere && <SignInLinks busy={busy} onStart={(provider) => void own.start(provider)} />}
      </>
    );
  }

  const anyYet = keys.length > 0 || signIns.length > 0;
  return (
    <>
      {anyYet && (
        <div className="pick-accounts">
          {keys.map((ownKey) => (
            <KeyRow
              key={ownKey.provider}
              ownKey={ownKey}
              busy={busy}
              onRemove={() => setOpened({ kind: 'removing', ownKey })}
            />
          ))}
          {signIns.map((signIn) => (
            <AccountRow
              key={signIn.id}
              account={signIn}
              busy={busy}
              onSignOut={() => setOpened({ kind: 'leaving', signIn })}
            />
          ))}
        </div>
      )}
      {!keysHere && <div className="acct-verify">This server doesn’t take keys yet.</div>}
      {action}
    </>
  );
}

function KeyRow({ ownKey, busy, onRemove }: { ownKey: OwnKey; busy: boolean; onRemove: () => void }) {
  return (
    <div className="pick-account">
      <span>
        {keyProviderName(ownKey.provider)}
        <small>Key ending in {ownKey.hint}</small>
      </span>
      <button type="button" className="login-link" disabled={busy} onClick={onRemove}>Remove</button>
    </div>
  );
}

function KeyLinks({ busy, onAdd }: { busy: boolean; onAdd: (provider: KeyProvider) => void }) {
  return (
    <div className="pick-signin">
      <span>Add a key</span>
      {KEY_PROVIDERS.map((provider) => (
        <button key={provider} type="button" className="login-link" disabled={busy} onClick={() => onAdd(provider)}>
          {keyProviderName(provider)}
        </button>
      ))}
    </div>
  );
}

interface AddKeyProps {
  provider: KeyProvider;
  /** The key it takes the place of, if there's one. */
  had: OwnKey | null;
  busy: boolean;
  onCancel: () => void;
  onSave: (key: string) => void;
}

/** A key pasted in, checked with its provider before it's kept. */
function AddKey({ provider, had, busy, onCancel, onSave }: AddKeyProps) {
  const ref = useInView<HTMLFormElement>();
  const [key, setKey] = useState('');
  const given = key.trim();
  const name = keyProviderName(provider);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (given) {
      onSave(given);
    }
  };

  let label = 'Save';
  if (busy) {
    label = 'Checking…';
  }
  return (
    <form className="pick-wait" ref={ref} onSubmit={submit}>
      <p>
        Paste your {name} key, from {KEY_WHERE[provider]}. It’s checked with {name} first, then kept
        sealed; only its last four characters show again.
      </p>
      {had && <p>It takes the place of your key ending in {had.hint}.</p>}
      <input
        className="add-input login-input"
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder={`Your ${name} key`}
        aria-label={`Your ${name} key`}
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />
      <div className="add-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={!given || busy}>{label}</button>
      </div>
    </form>
  );
}

interface RemoveKeyProps {
  ownKey: OwnKey;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function RemoveKey({ ownKey, busy, onCancel, onConfirm }: RemoveKeyProps) {
  const ref = useInView<HTMLDivElement>();
  let label = 'Remove';
  if (busy) {
    label = 'Removing…';
  }
  return (
    <div className="acct-confirm" ref={ref}>
      <p>Remove your {keyProviderName(ownKey.provider)} key? Its models go with it until it’s added again.</p>
      <div className="add-actions">
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={onConfirm}>{label}</button>
      </div>
    </div>
  );
}
