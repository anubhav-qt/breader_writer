import { useEffect, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import type { BookSetup } from '@writer/shared/book';
import type { BookCard } from '@writer/shared/protocol';
import { fetchSetup, missing, saveSetup } from '../../data/setup';
import { failureText } from '../../lib/api';
import { ConfirmDialog } from './ConfirmDialog';
import { SetupForm, SetupShell } from './SetupPage';

interface Props {
  bookId: string;
  onSaved: (card: BookCard) => void;
  onClose: () => void;
}

/** The setup as it's saved, while it loads, or why it didn't. */
type Saved =
  | { state: 'loading' }
  | { state: 'failed'; message: string }
  | { state: 'ready'; setup: BookSetup };

/** What a book was set up with, to look over and change. Nothing changes until it's saved. */
export function EditSetup({ bookId, onSaved, onClose }: Props) {
  const [saved, setSaved] = useState<Saved>({ state: 'loading' });
  const [setup, setSetup] = useState<BookSetup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let live = true;
    fetchSetup(bookId)
      .then((loaded) => {
        if (!live) return;
        setSaved({ state: 'ready', setup: loaded });
        setSetup(loaded);
      })
      .catch((e) => {
        if (!live) return;
        setSaved({ state: 'failed', message: failureText(e) });
      });
    return () => { live = false; };
  }, [bookId]);

  if (saved.state !== 'ready' || !setup) {
    let note = null;
    if (saved.state === 'failed') {
      note = <p className="setup-note is-error" role="alert">{saved.message}</p>;
    }
    return (
      <SetupShell onClose={onClose}>
        <main className="setup setup-waiting">{note}</main>
      </SetupShell>
    );
  }

  const changed = JSON.stringify(setup) !== JSON.stringify(saved.setup);
  const close = () => {
    if (changed) {
      setLeaving(true);
    } else {
      onClose();
    }
  };
  const change = (next: BookSetup) => {
    setError(null);
    setSetup(next);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const card = await saveSetup(bookId, setup);
      onSaved(card);
    } catch (e) {
      setError(failureText(e));
      setBusy(false);
    }
  };

  const needed = missing(setup);
  let note = null;
  if (error) {
    note = <p className="setup-note is-error" role="alert">{error}</p>;
  } else if (needed) {
    note = <p className="setup-note">{needed}</p>;
  }

  return (
    <SetupShell onClose={close}>
      <SetupForm
        heading={saved.setup.title}
        setup={setup}
        onChange={change}
        suggestPov={false}
        onPovPicked={() => {}}
        bookId={bookId}
        actions={
          <>
            {note}
            <button type="button" className="btn btn-primary setup-go" disabled={!changed || needed !== null || busy} onClick={() => void save()}>
              Save
            </button>
          </>
        }
      />
      <AnimatePresence>
        {leaving && (
          <ConfirmDialog
            key="leave"
            title="Leave without saving?"
            text="What you changed here won’t be kept."
            go="Leave"
            stay="Keep editing"
            onGo={onClose}
            onClose={() => setLeaving(false)}
          />
        )}
      </AnimatePresence>
    </SetupShell>
  );
}
