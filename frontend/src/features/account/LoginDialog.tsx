import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { AccountResponse } from '@breader/shared/protocol';
import { Modal } from '../../components/Modal';
import { IconChevron, IconKey, IconUpload } from '../../components/icons';
import { logIn, logInWithGoogle, loginError, refreshAccount, requestReset, resetPassword, signUp } from '../../lib/account';
import { springs } from '../../lib/springs';
import '../add/add.css';
import './account.css';

/*
 * Logging in, and what happens to this browser's books after (data/sync.ts enterAccount):
 *
 *   login, signup   email and password, or Google
 *   forgot, sent    a reset link by email
 *   reset           the page that link opens: choose a new password
 *   entering        logged in; moving this browser to the account's library
 *   choose          this browser holds books the account doesn't: move them in, or leave them
 */

export type LoginStart =
  | { mode: 'login' | 'signup' }
  | { mode: 'reset'; token: string }
  /** Back from Google, or logged in by an email link: go straight to the library. */
  | { mode: 'entering' };

type Step =
  | { mode: 'login' | 'signup' | 'forgot' }
  | { mode: 'sent'; email: string }
  | { mode: 'reset'; token: string }
  | { mode: 'entering'; claim?: boolean }
  | { mode: 'choose'; books: number }
  | { mode: 'failed'; message: string };

interface Props {
  start: LoginStart;
  google: boolean;
  /** Waits for the library to load before moving it. */
  ready: boolean;
  /** This browser's key, shown when its books are left under it. */
  localKey: string | null;
  enter: (claim?: boolean) => Promise<AccountResponse>;
  onDone: (res: AccountResponse) => void;
  onClose: () => void;
}

const TITLES: Record<Step['mode'], string> = {
  login: 'Log in',
  signup: 'Create an account',
  forgot: 'Reset your password',
  sent: 'Check your email',
  reset: 'Choose a new password',
  entering: 'Opening your library',
  choose: 'Books in this browser',
  failed: 'Your library',
};

const GoogleG = () => (
  <svg viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

export function LoginDialog({ start, google, ready, localKey, enter, onDone, onClose }: Props) {
  const [step, setStep] = useState<Step>(start);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const running = useRef(false);
  const latest = useRef({ enter, onDone });
  latest.current = { enter, onDone };

  const go = (next: Step) => {
    setStep(next);
    setError(null);
  };

  /** Runs one step of the form, showing its error under it. */
  const attempt = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(loginError(e));
    } finally {
      setBusy(false);
    }
  };

  // Logged in: move this browser to the account's library, once the library has loaded.
  useEffect(() => {
    if (step.mode !== 'entering' || !ready || running.current) return;
    running.current = true;
    void latest.current.enter(step.claim)
      .then((res) => {
        if (res.outcome === 'choose') go({ mode: 'choose', books: res.books ?? 0 });
        else latest.current.onDone(res);
      })
      .catch((e) => go({ mode: 'failed', message: loginError(e) }))
      .finally(() => { running.current = false; });
  }, [step, ready]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const address = email.trim();
    if (step.mode === 'login') void attempt(async () => { await logIn(address, password); go({ mode: 'entering' }); });
    else if (step.mode === 'signup') void attempt(async () => { await signUp(address, password); go({ mode: 'entering' }); });
    else if (step.mode === 'forgot') void attempt(async () => { await requestReset(address); go({ mode: 'sent', email: address }); });
    else if (step.mode === 'reset') {
      const { token } = step;
      void attempt(async () => {
        await resetPassword(token, password);
        // A new password ends every login, this browser's included.
        await refreshAccount();
        setPassword('');
        setNote('Your password is changed. Log in with the new one.');
        go({ mode: 'login' });
      });
    }
  };

  const google_ = () => void attempt(() => logInWithGoogle());
  const form = step.mode === 'login' || step.mode === 'signup' || step.mode === 'forgot' || step.mode === 'reset';
  const needsEmail = step.mode !== 'reset';
  const needsPassword = step.mode !== 'forgot';
  const valid = (!needsEmail || /^\S+@\S+\.\S+$/.test(email.trim())) && (!needsPassword || password.length >= (step.mode === 'login' ? 1 : 8));

  return (
    <Modal title={TITLES[step.mode]} onClose={onClose} width={420}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step.mode}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16, transition: { duration: 0.12 } }}
          transition={springs.snappy}
          className="add"
        >
          {form && (
            <form className="login" onSubmit={submit} noValidate>
              {note && step.mode === 'login' && <p className="login-note" role="status">{note}</p>}
              {step.mode === 'forgot' && <p className="add-local">We’ll email you a link to choose a new password.</p>}
              {google && (step.mode === 'login' || step.mode === 'signup') && (
                <>
                  <button type="button" className="btn btn-quiet login-google" disabled={busy} onClick={google_}>
                    <GoogleG /> Continue with Google
                  </button>
                  <div className="add-or">or</div>
                </>
              )}
              {needsEmail && (
                <>
                  <label className="add-label" htmlFor="login-email">Email</label>
                  <input
                    id="login-email"
                    className="add-input login-input"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    autoFocus
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(null); }}
                    disabled={busy}
                  />
                </>
              )}
              {needsPassword && (
                <>
                  <div className="login-row">
                    <label className="add-label" htmlFor="login-password">{step.mode === 'reset' ? 'New password' : 'Password'}</label>
                    {step.mode === 'login' && (
                      <button type="button" className="login-link" onClick={() => go({ mode: 'forgot' })}>Forgot password?</button>
                    )}
                  </div>
                  <input
                    id="login-password"
                    className="add-input login-input"
                    type="password"
                    autoComplete={step.mode === 'login' ? 'current-password' : 'new-password'}
                    autoFocus={step.mode === 'reset'}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(null); }}
                    disabled={busy}
                  />
                  {step.mode !== 'login' && <p className="add-local">At least 8 characters.</p>}
                </>
              )}
              {error && <p className="add-local key-error" role="alert">{error}</p>}
              <button type="submit" className="btn btn-primary login-submit" disabled={!valid || busy}>
                {busy ? 'One moment…' : { login: 'Log in', signup: 'Create account', forgot: 'Send link', reset: 'Save password' }[step.mode]}
              </button>
              {step.mode === 'login' && (
                <p className="login-switch">New here? <button type="button" className="login-link" onClick={() => go({ mode: 'signup' })}>Create an account</button></p>
              )}
              {step.mode === 'signup' && (
                <p className="login-switch">Have an account? <button type="button" className="login-link" onClick={() => go({ mode: 'login' })}>Log in</button></p>
              )}
              {step.mode === 'forgot' && (
                <p className="login-switch"><button type="button" className="login-link" onClick={() => go({ mode: 'login' })}>Back to log in</button></p>
              )}
            </form>
          )}

          {step.mode === 'sent' && (
            <>
              <p className="add-keynote">If there’s an account for {step.email}, a link to reset its password is on its way. It works for an hour.</p>
              <div className="add-actions">
                <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
              </div>
            </>
          )}

          {step.mode === 'entering' && (
            <div className="add-busy">
              <span className="add-spinner" aria-hidden="true" />
              <span>{step.claim ? 'Moving your books…' : 'Opening your library…'}</span>
            </div>
          )}

          {step.mode === 'choose' && (
            <>
              <p className="add-keynote">
                This browser has {step.books === 1 ? 'a book' : `${step.books} books`} that {step.books === 1 ? 'isn’t' : 'aren’t'} in your account yet.
              </p>
              <div className="add-choices">
                <button type="button" className="add-choice" onClick={() => go({ mode: 'entering', claim: true })}>
                  <IconUpload />
                  <span><b>Move {step.books === 1 ? 'it' : 'them'} to my account</b><span>Your account keeps them from now on, with your other books.</span></span>
                  <IconChevron className="login-go" />
                </button>
                <button type="button" className="add-choice" onClick={() => go({ mode: 'entering', claim: false })}>
                  <IconKey />
                  <span>
                    <b>Keep {step.books === 1 ? 'it' : 'them'} separate</b>
                    <span>{localKey ? `Only the key ${localKey} opens ${step.books === 1 ? 'it' : 'them'}. Copy it first if you haven’t kept it.` : 'They stay in their own library.'}</span>
                  </span>
                  <IconChevron className="login-go" />
                </button>
              </div>
            </>
          )}

          {step.mode === 'failed' && (
            <>
              <p className="add-keynote">You’re logged in, but Breader couldn’t open your library. {step.message}</p>
              <div className="add-actions">
                <button type="button" className="btn btn-ghost" onClick={onClose}>Not now</button>
                <button type="button" className="btn btn-primary" onClick={() => go({ mode: 'entering' })}>Try again</button>
              </div>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </Modal>
  );
}
