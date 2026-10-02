import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useSyncStatus } from '../../data/sync';
import { loginError, sendVerification, type AccountState } from '../../lib/account';
import { springs } from '../../lib/springs';
import './account.css';

interface Props {
  account: AccountState;
  onLogin: () => void;
  /** Ends the login and clears this browser's library. */
  onLogOut: () => Promise<void>;
}

/** The header's Log in button, or, once logged in, the account's initial with its menu. */
export function AccountMenu({ account, onLogin, onLogOut }: Props) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const sync = useSyncStatus();

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  useEffect(() => {
    if (open) return;
    setConfirming(false);
    setMessage(null);
  }, [open]);

  const user = account.status === 'in' ? account.user : null;
  if (!user) {
    return (
      <button type="button" className="btn btn-ghost" onClick={onLogin}>
        Log in
      </button>
    );
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage(loginError(e));
    } finally {
      setBusy(false);
    }
  };

  const initial = (user.name || user.email).trim().charAt(0).toUpperCase() || '?';

  return (
    <div className="acct" ref={root}>
      <button
        type="button"
        className="acct-btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Account: ${user.email}`}
        title={user.email}
        onClick={() => setOpen((o) => !o)}
      >
        {initial}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="acct-menu"
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
            transition={springs.snappy}
          >
            <div className="acct-who">
              <span>Logged in as</span>
              <b>{user.email}</b>
            </div>
            {!user.emailVerified && (
              <div className="acct-verify">
                <span>Confirm your email with the link we sent you.</span>
                <button type="button" className="login-link" disabled={busy} onClick={() => void run(async () => { await sendVerification(); setMessage('Sent. Check your inbox.'); })}>
                  Send it again
                </button>
              </div>
            )}
            {message && <p className="acct-message" role="status">{message}</p>}
            <div className="acct-sep" />
            {confirming ? (
              <div className="acct-confirm">
                <p>
                  {sync.pending
                    ? `${sync.pending === 1 ? '1 change hasn’t' : `${sync.pending} changes haven’t`} reached your account yet, and would be lost. Log out anyway?`
                    : 'Your books stay in your account. Logging out removes them from this browser.'}
                </p>
                <div className="add-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(onLogOut)}>
                    {busy ? 'Logging out…' : 'Log out'}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" role="menuitem" className="acct-item" onClick={() => setConfirming(true)}>Log out</button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
