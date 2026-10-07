import { useEffect, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import type { BookSetup } from '@writer/shared/book';
import type { BookCard } from '@writer/shared/protocol';
import { blankSetup, clearDraft, isBlank, makeBook, missing, readDraft, writeDraft, type Draft } from '../../data/setup';
import { failureText } from '../../lib/api';
import { ConfirmDialog } from './ConfirmDialog';
import { SetupForm, SetupShell } from './SetupPage';

interface Props {
  /** The colour a new book gets, from the library's pool. */
  color: string;
  onMade: (card: BookCard) => void;
  onClose: () => void;
}

function startingDraft(color: string): Draft {
  const saved = readDraft();
  if (saved) {
    return saved;
  }
  return { setup: blankSetup(color), povChosen: false, chatId: null };
}

/** Setting up a new book. What's typed is kept in this browser until the book is started. */
export function NewBook({ color, onMade, onClose }: Props) {
  const [draft, setDraft] = useState<Draft>(() => startingDraft(color));
  // Nothing is written until something is typed, so a draft this page can't read is left alone.
  const [typed, setTyped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (!typed) {
      return;
    }
    // A chat started on a blank page is kept, so the draft is too.
    if (isBlank(draft.setup) && !draft.chatId) {
      clearDraft();
    } else {
      writeDraft(draft);
    }
  }, [draft, typed]);

  const setSetup = (setup: BookSetup) => {
    setError(null);
    setTyped(true);
    setDraft((d) => ({ ...d, setup }));
  };
  const povPicked = () => setDraft((d) => ({ ...d, povChosen: true }));
  const chatStarted = (chatId: string) => {
    setTyped(true);
    setDraft((d) => ({ ...d, chatId }));
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const card = await makeBook(draft.setup);
      clearDraft();
      onMade(card);
    } catch (e) {
      setError(failureText(e));
      setBusy(false);
    }
  };

  const clear = () => {
    setClearing(false);
    clearDraft();
    setDraft({ setup: blankSetup(color), povChosen: false, chatId: null });
  };

  // A chat is something to clear too, even on a blank page.
  let canClear = !isBlank(draft.setup);
  if (draft.chatId) {
    canClear = true;
  }
  const needed = missing(draft.setup);
  let note = null;
  if (error) {
    note = <p className="setup-note is-error" role="alert">{error}</p>;
  } else if (needed) {
    note = <p className="setup-note">{needed}</p>;
  }

  return (
    <SetupShell onClose={onClose}>
      <SetupForm
        heading="New book"
        setup={draft.setup}
        onChange={setSetup}
        suggestPov={!draft.povChosen}
        onPovPicked={povPicked}
        bookId={null}
        chatId={draft.chatId}
        onChatStarted={chatStarted}
        actions={
          <>
            {note}
            {canClear && (
              <button type="button" className="btn btn-ghost" onClick={() => setClearing(true)}>Clear</button>
            )}
            <button type="button" className="btn btn-primary setup-go" disabled={needed !== null || busy} onClick={() => void start()}>
              Start
            </button>
          </>
        }
      />
      <AnimatePresence>
        {clearing && (
          <ConfirmDialog
            key="clear"
            title="Clear this book?"
            text="Everything typed for it goes, the cast and the Suggestions chat too."
            go="Clear"
            stay="Keep it"
            onGo={clear}
            onClose={() => setClearing(false)}
          />
        )}
      </AnimatePresence>
    </SetupShell>
  );
}
