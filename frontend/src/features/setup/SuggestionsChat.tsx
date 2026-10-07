import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { motion } from 'motion/react';
import type { BookSetup } from '@writer/shared/book';
import { SAY_LIMIT, type ChangeList, type ChatEntry } from '@writer/shared/chat';
import { IconCheck, IconClose } from '../../components/icons';
import { itemView, type ItemView } from '../../data/chat';
import { springs } from '../../lib/springs';
import type { ChatState, Pending } from './useChat';
import '../../components/modal.css';
import './chat.css';

/*
 * The Suggestions chat (step 5): talking the setup over with Procreator. On a laptop it's a panel
 * beside the page, which stays in view, so approved changes land where the owner can watch them;
 * on a phone it rises as a sheet over the page (the owner's pick, 2026-10-06). The owner's words
 * sit in a grey bubble on the right, and Procreator's run plainly across, lists included.
 */

interface Props {
  /** The chat, held by the page (useChat), so closing this doesn't stop an answer. */
  state: ChatState;
  /** The page as it stands, to name people in the lists. */
  setup: BookSetup;
  /** A panel beside the page, or a sheet over it. */
  wide: boolean;
  /** The owner approved this entry's list, for the page to land. */
  onApprove: (entry: number) => void;
  onClose: () => void;
}

export function SuggestionsChat({ state, setup, wide, onApprove, onClose }: Props) {
  // Beside the page the box takes the focus; over it, a phone's keyboard would cover the chat.
  const body = <ChatBody state={state} setup={setup} focusBox={wide} onApprove={onApprove} onClose={onClose} />;
  if (wide) {
    return (
      <motion.aside
        className="chat-panel"
        aria-label="Suggestions"
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 24 }}
        transition={springs.smooth}
      >
        {body}
      </motion.aside>
    );
  }
  return <ChatSheet onClose={onClose}>{body}</ChatSheet>;
}

/** The chat as a sheet over the page, rising from the bottom. Escape closes it, as it does a dialog. */
function ChatSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') {
        return;
      }
      // A dialog opened over this one closes first, on its own.
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] === ref.current) {
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      before?.focus?.({ preventScroll: true });
    };
  }, []);

  return (
    <div className="chat-sheet-root">
      <motion.div className="modal-scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
      <motion.div
        ref={ref}
        className="chat-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Suggestions"
        tabIndex={-1}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={springs.smooth}
      >
        {children}
      </motion.div>
    </div>
  );
}

interface BodyProps {
  state: ChatState;
  setup: BookSetup;
  /** Whether the box takes the focus as the chat opens. */
  focusBox: boolean;
  onApprove: (entry: number) => void;
  onClose: () => void;
}

function ChatBody({ state, setup, focusBox, onApprove, onClose }: BodyProps) {
  const logRef = useRef<HTMLDivElement>(null);
  let entries: ChatEntry[] = [];
  if (state.chat) {
    entries = state.chat.entries;
  }

  // New words keep the log at its end. A redo or an approval changes a list in place, and
  // nothing moves.
  const count = entries.length;
  let saying = null;
  let reply = null;
  if (state.pending) {
    saying = state.pending.text;
    reply = state.pending.reply;
  }
  useLayoutEffect(() => {
    const log = logRef.current;
    if (log) {
      log.scrollTop = log.scrollHeight;
    }
  }, [count, saying, reply, state.loading]);

  let opening = null;
  if (state.loading) {
    opening = <Busy text="Opening the chat" />;
  } else if (count === 0 && !state.pending) {
    opening = (
      <p className="chat-empty">
        Ask for anything about the setup: a title, someone new, how two people feel about each other. Nothing changes until you approve it.
      </p>
    );
  }

  let answering = null;
  if (state.pending) {
    answering = <Answering pending={state.pending} />;
  }

  // Under the log rather than in it, so it's in view whatever failed, and the log doesn't move.
  let error = null;
  if (state.error) {
    error = <p className="setup-note is-error chat-error" role="alert">{state.error}</p>;
  }

  return (
    <div className="chat">
      <div className="modal-head chat-head">
        <h2 className="modal-title">Suggestions</h2>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close the suggestions">
          <IconClose />
        </button>
      </div>
      <div className="chat-log" ref={logRef}>
        {opening}
        {entries.map((entry) => (
          <Entry key={entry.id} entry={entry} state={state} setup={setup} onApprove={onApprove} />
        ))}
        {answering}
      </div>
      {error}
      <SayBox state={state} focus={focusBox} />
    </div>
  );
}

/** A spinner and what's happening. */
function Busy({ text }: { text: string }) {
  return (
    <div className="add-busy chat-busy" role="status">
      <span className="add-spinner" aria-hidden="true" />
      {text}
    </div>
  );
}

/** Procreator's words, a paragraph for each run of text between blank lines. */
function Words({ text }: { text: string }) {
  const paragraphs: string[] = [];
  for (const part of text.split(/\n\s*\n/)) {
    const paragraph = part.trim();
    if (paragraph) {
      paragraphs.push(paragraph);
    }
  }
  return (
    <>
      {paragraphs.map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </>
  );
}

/** What the owner just said, and Procreator's answer as it comes. */
function Answering({ pending }: { pending: Pending }) {
  let reply;
  if (pending.reply.trim() === '') {
    reply = <Busy text="Procreator is thinking" />;
  } else {
    reply = (
      <div className="chat-procreator">
        <Words text={pending.reply} />
      </div>
    );
  }
  return (
    <>
      <div className="chat-owner">{pending.text}</div>
      {reply}
    </>
  );
}

interface EntryProps {
  entry: ChatEntry;
  state: ChatState;
  setup: BookSetup;
  onApprove: (entry: number) => void;
}

function Entry({ entry, state, setup, onApprove }: EntryProps) {
  if (entry.by === 'owner') {
    return <div className="chat-owner">{entry.text}</div>;
  }
  let list = null;
  if (entry.list) {
    list = <ListView entryId={entry.id} list={entry.list} state={state} setup={setup} onApprove={onApprove} />;
  }
  return (
    <div className="chat-procreator">
      <Words text={entry.text} />
      {list}
    </div>
  );
}

interface ListProps {
  entryId: number;
  list: ChangeList;
  state: ChatState;
  setup: BookSetup;
  onApprove: (entry: number) => void;
}

/** A list of changes: each item as it will land, then Approve, or how the list ended. */
function ListView({ entryId, list, state, setup, onApprove }: ListProps) {
  const open = list.state === 'open';
  let className = 'chat-list';
  if (list.state === 'set_aside') {
    className += ' is-set-aside';
  }

  let end;
  if (open) {
    end = (
      <button type="button" className="btn btn-primary" disabled={state.busy} onClick={() => onApprove(entryId)}>
        Approve
      </button>
    );
  } else if (list.state === 'approved') {
    end = (
      <span className="chip chat-state">
        <IconCheck /> Approved
      </span>
    );
  } else {
    end = <span className="chip chat-state">Set aside</span>;
  }

  return (
    <div className={className}>
      <ol className="chat-items">
        {list.items.map((change, index) => {
          let redoing = false;
          if (state.redoing) {
            redoing = state.redoing.entry === entryId && state.redoing.item === index;
          }
          return (
            <Item
              key={index}
              view={itemView(change, setup, list.items)}
              open={open}
              redoing={redoing}
              busy={state.busy}
              onRedo={(notes) => state.redo(entryId, index, notes)}
            />
          );
        })}
      </ol>
      <div className="chat-list-end">{end}</div>
    </div>
  );
}

interface ItemProps {
  view: ItemView;
  /** Whether the list is still open, so the item can be redone. */
  open: boolean;
  /** Whether Procreator is redoing this item now. */
  redoing: boolean;
  busy: boolean;
  /** Has the item redone with the owner's notes. Answers whether it was. */
  onRedo: (notes: string) => Promise<boolean>;
}

/** An item of a list: where it lands, exactly what lands, and the Writer's notes to redo it. */
function Item({ view, open, redoing, busy, onRedo }: ItemProps) {
  const [writing, setWriting] = useState(false);
  const [notes, setNotes] = useState('');

  const send = async () => {
    const said = notes.trim();
    if (!said || busy) {
      return;
    }
    const redone = await onRedo(said);
    // Notes that didn't get through stay, to send again.
    if (redone) {
      setWriting(false);
      setNotes('');
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (sends(e)) {
      e.preventDefault();
      void send();
    }
  };

  let details = null;
  if (view.details.length > 0) {
    details = (
      <dl className="chat-details">
        {view.details.map((line) => (
          <div key={line.label}>
            <dt className="add-label">{line.label}</dt>
            <dd>{line.text}</dd>
          </div>
        ))}
      </dl>
    );
  }

  let redo = null;
  if (open && redoing) {
    redo = <Busy text="Procreator is redoing this one" />;
  } else if (open) {
    let box = null;
    if (writing) {
      box = (
        <div className="chat-notes">
          <textarea
            className="add-text chat-notes-box"
            value={notes}
            maxLength={SAY_LIMIT}
            autoFocus
            aria-label="Writer’s notes"
            placeholder="What should change about this one"
            onChange={(e) => setNotes(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <div className="chat-notes-actions">
            <button type="button" className="btn btn-quiet" disabled={busy || !notes.trim()} onClick={() => void send()}>
              Redo
            </button>
          </div>
        </div>
      );
    }
    redo = (
      <>
        <button type="button" className="btn btn-ghost chat-notes-open" aria-expanded={writing} onClick={() => setWriting(!writing)}>
          Writer’s notes
        </button>
        {box}
      </>
    );
  }

  return (
    <li className="chat-item">
      <span className="add-label">{view.where}</span>
      <p className="chat-item-text">{view.text}</p>
      {details}
      {redo}
    </li>
  );
}

/** Enter sends; Shift and Enter starts a new line. */
function sends(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
  if (e.key !== 'Enter') {
    return false;
  }
  if (e.shiftKey) {
    return false;
  }
  // Enter also ends a word being composed (Japanese, Chinese), which isn't sending.
  if (e.nativeEvent.isComposing) {
    return false;
  }
  return true;
}

/** The owner's words put back in the box, before anything typed there since. */
function withWordsBack(words: string, box: string): string {
  if (box.trim() === '') {
    return words;
  }
  return `${words}\n\n${box}`;
}

/** Where the owner says something. */
function SayBox({ state, focus }: { state: ChatState; focus: boolean }) {
  const [text, setText] = useState('');

  let blocked = state.busy;
  if (state.loading) {
    blocked = true;
  }

  const send = async () => {
    const words = text.trim();
    if (!words || blocked) {
      return;
    }
    setText('');
    const taken = await state.say(words);
    // The server never had them, so they're still the owner's.
    if (!taken) {
      setText((box) => withWordsBack(words, box));
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (sends(e)) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <form
      className="chat-say"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <textarea
        className="add-text chat-box"
        value={text}
        rows={1}
        maxLength={SAY_LIMIT}
        autoFocus={focus}
        aria-label="Say something to Procreator"
        placeholder="Ask Procreator"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button type="submit" className="btn btn-primary" disabled={blocked || !text.trim()}>
        Send
      </button>
    </form>
  );
}
