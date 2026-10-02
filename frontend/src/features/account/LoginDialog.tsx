import { useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Modal } from '../../components/Modal';
import { logIn, logInWithGoogle, loginError, requestReset, signUp } from '../../lib/account';
import { springs } from '../../lib/springs';
import '../add/add.css';
import './account.css';

/*
 * Logging in with a breader account, through breader's own API:
 *
 *   login, signup   email and password, or Google
 *   forgot, sent    a reset link by email; it opens breader, which has the page for a new password
 */

type Step =
  | { mode: 'login' | 'signup' | 'forgot' }
  | { mode: 'sent'; email: string };

interface Props {
  google: boolean;
  onDone: () => void;
  onClose: () => void;
}

const TITLES: Record<Step['mode'], string> = {
  login: 'Log in',
  signup: 'Create an account',
  forgot: 'Reset your password',
  sent: 'Check your email',
};

const SUBMIT = {
  login: 'Log in',
  signup: 'Create account',
  forgot: 'Send link',
};

const GoogleG = () => (
  <svg viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

export function LoginDialog({ google, onDone, onClose }: Props) {
  const [step, setStep] = useState<Step>({ mode: 'login' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const address = email.trim();
    if (step.mode === 'login') {
      void attempt(async () => {
        await logIn(address, password);
        onDone();
      });
    } else if (step.mode === 'signup') {
      void attempt(async () => {
        await signUp(address, password);
        onDone();
      });
    } else if (step.mode === 'forgot') {
      void attempt(async () => {
        await requestReset(address);
        go({ mode: 'sent', email: address });
      });
    }
  };

  const google_ = () => void attempt(() => logInWithGoogle());
  const needsPassword = step.mode !== 'forgot';
  const minimum = step.mode === 'login' ? 1 : 8;
  let valid = /^\S+@\S+\.\S+$/.test(email.trim());
  if (needsPassword && password.length < minimum) valid = false;

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
          {step.mode !== 'sent' && (
            <form className="login" onSubmit={submit} noValidate>
              {step.mode === 'login' && <p className="add-local">The writer uses your breader account.</p>}
              {step.mode === 'forgot' && <p className="add-local">We’ll email you a link to choose a new password.</p>}
              {google && step.mode !== 'forgot' && (
                <>
                  <button type="button" className="btn btn-quiet login-google" disabled={busy} onClick={google_}>
                    <GoogleG /> Continue with Google
                  </button>
                  <div className="add-or">or</div>
                </>
              )}
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
              {needsPassword && (
                <>
                  <div className="login-row">
                    <label className="add-label" htmlFor="login-password">Password</label>
                    {step.mode === 'login' && (
                      <button type="button" className="login-link" onClick={() => go({ mode: 'forgot' })}>Forgot password?</button>
                    )}
                  </div>
                  <input
                    id="login-password"
                    className="add-input login-input"
                    type="password"
                    autoComplete={step.mode === 'login' ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(null); }}
                    disabled={busy}
                  />
                  {step.mode === 'signup' && <p className="add-local">At least 8 characters.</p>}
                </>
              )}
              {error && <p className="add-local key-error" role="alert">{error}</p>}
              <button type="submit" className="btn btn-primary login-submit" disabled={!valid || busy}>
                {busy ? 'One moment…' : SUBMIT[step.mode]}
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
        </motion.div>
      </AnimatePresence>
    </Modal>
  );
}
