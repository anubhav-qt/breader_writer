import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { LONG_LIMIT } from '@writer/shared/book';
import { isAhead, type MemoryNote, type PageKind, type ReferencePage, type StoryView } from '@writer/shared/story';
import { IconClose, IconPlus, IconTrash } from '../../components/icons';
import { springs } from '../../lib/springs';
import { ConfirmDialog } from '../setup/ConfirmDialog';
import { ChatSheet } from '../setup/SuggestionsChat';
import type { StoryState } from './useStory';
import '../setup/setup.css';
import '../setup/chat.css';
import './story.css';

/*
 * The Notes panel (step 6): Procreator's notes, a panel away (the owner's pick, 2026-10-07). It
 * opens as the Story panel does, beside the play on a laptop and over it on a phone. The
 * reference's pages by kind (places, groups, things, lore, and the story's own Plan, Threads and
 * Timeline), each opening as a sheet over the page, then Procreator's memory, each note editable
 * where it is. A character's page is in their sheet, below the owner's. Plan and Threads say where
 * the story is going, so opening one asks first (the owner's pick, 2026-10-07).
 */

interface Props {
  state: StoryState;
  /** A panel beside the play, or a sheet over it. */
  wide: boolean;
  /** Procreator is writing in the book, so nothing can be saved until it's done. */
  held: boolean;
  onClose: () => void;
}

export function NotesPanel({ state, wide, held, onClose }: Props) {
  const body = <NotesBody state={state} held={held} onClose={onClose} />;
  if (wide) {
    return (
      <motion.aside
        className="chat-panel story-panel"
        aria-label="Notes"
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 24 }}
        transition={springs.smooth}
      >
        {body}
      </motion.aside>
    );
  }
  return (
    <ChatSheet label="Notes" onClose={onClose}>
      {body}
    </ChatSheet>
  );
}

function NotesBody({ state, held, onClose }: { state: StoryState; held: boolean; onClose: () => void }) {
  const story = state.story;
  let content = null;
  if (story) {
    content = <NotesContent story={story} state={state} held={held} />;
  } else if (state.error) {
    content = (
      <p className="setup-note is-error story-error" role="alert">
        {state.error}
      </p>
    );
  } else {
    content = (
      <div className="add-busy story-loading" role="status">
        <span className="add-spinner" aria-hidden="true" />
        Reading Procreator’s notes
      </div>
    );
  }
  return (
    <div className="chat story">
      <div className="modal-head chat-head">
        <h2 className="modal-title">Notes</h2>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close the notes">
          <IconClose />
        </button>
      </div>
      {content}
    </div>
  );
}

/** The kinds of page, as the panel heads them, in the order Procreator's index has them. */
const SECTIONS: { kind: PageKind; title: string }[] = [
  { kind: 'place', title: 'Places' },
  { kind: 'group', title: 'Groups' },
  { kind: 'thing', title: 'Things' },
  { kind: 'lore', title: 'Lore' },
  { kind: 'story', title: 'The story' },
];

function NotesContent({ story, state, held }: { story: StoryView; state: StoryState; held: boolean }) {
  // Plan or Threads, waiting for the owner to say they want to read where the story is going.
  const [asking, setAsking] = useState<ReferencePage | null>(null);

  const openPage = (page: ReferencePage) => {
    if (isAhead(page)) {
      setAsking(page);
      return;
    }
    state.open({ kind: 'page', id: page.id });
  };
  const readAhead = () => {
    if (asking) {
      state.open({ kind: 'page', id: asking.id });
    }
    setAsking(null);
  };

  const others = story.reference.filter((page) => page.characterId === null);
  let empty = null;
  if (others.length === 0) {
    empty = <p className="notes-empty">Procreator hasn’t written any pages yet. They come as the story goes: places, groups, things, the world’s lore, and where the story is heading.</p>;
  }

  // A failure is shown at the panel's top, unless a sheet has it.
  let error = null;
  if (state.error && !state.opened) {
    error = (
      <p className="setup-note is-error story-error" role="alert">
        {state.error}
      </p>
    );
  }

  return (
    <>
      <div className="story-scroll">
        {error}
        <section className="setup-section" aria-labelledby="notes-pages">
          <h2 id="notes-pages">Pages</h2>
          {empty}
          {SECTIONS.map((section) => {
            const pages = others.filter((page) => page.kind === section.kind);
            if (pages.length === 0) {
              return null;
            }
            return (
              <div key={section.kind} className="notes-kind">
                <div className="add-label">{section.title}</div>
                <div className="notes-pages">
                  {pages.map((page) => (
                    <PageRow key={page.id} page={page} onOpen={() => openPage(page)} />
                  ))}
                </div>
              </div>
            );
          })}
          <button type="button" className="btn btn-ghost notes-add" onClick={() => state.open({ kind: 'newPage' })}>
            <IconPlus /> New page
          </button>
        </section>

        <section className="setup-section" aria-labelledby="notes-memory">
          <h2 id="notes-memory">Procreator’s memory</h2>
          <p className="setup-hint">Its notes to itself about the work: what you like, what you’ve asked for, what it has learned about this book.</p>
          <Memory memory={story.memory} state={state} held={held} />
        </section>
      </div>
      <AnimatePresence>
        {asking && (
          <AheadDialog key="ahead" title={asking.title} onRead={readAhead} onClose={() => setAsking(null)} />
        )}
      </AnimatePresence>
    </>
  );
}

/** A page in the list: its title, and what it holds. */
function PageRow({ page, onOpen }: { page: ReferencePage; onOpen: () => void }) {
  return (
    <button type="button" className="notes-page" onClick={onOpen}>
      <span className="notes-page-title">{page.title}</span>
      {page.about && <span className="notes-page-about">{page.about}</span>}
    </button>
  );
}

/** Asks before Plan or Threads opens: they say where Procreator means to take the story (the owner's pick, 2026-10-07). */
function AheadDialog({ title, onRead, onClose }: { title: string; onRead: () => void; onClose: () => void }) {
  return (
    <ConfirmDialog
      title={title}
      text="This is where Procreator means to take the story. Read it?"
      go="Read it"
      stay="Not now"
      onGo={onRead}
      onClose={onClose}
      safe
    />
  );
}

/** Procreator's memory: each note editable where it is, and one to add at the end. */
function Memory({ memory, state, held }: { memory: MemoryNote[]; state: StoryState; held: boolean }) {
  const [forgetting, setForgetting] = useState<MemoryNote | null>(null);
  const forget = () => {
    if (forgetting) {
      void state.edit({ kind: 'forget', id: forgetting.id }, 'now');
    }
    setForgetting(null);
  };
  return (
    <>
      <div className="notes-memory">
        {memory.map((note) => (
          // Keyed by its text too, so a note saved starts afresh from what it says now.
          <NoteRow key={`${note.id} ${note.text}`} note={note} state={state} held={held} onForget={() => setForgetting(note)} />
        ))}
        <NewNote state={state} held={held} />
      </div>
      <AnimatePresence>
        {forgetting && (
          <ConfirmDialog
            key="forget"
            title="Forget this note?"
            text="Procreator won’t keep it in mind any more."
            go="Forget"
            stay="Keep it"
            onGo={forget}
            onClose={() => setForgetting(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function NoteRow({ note, state, held, onForget }: { note: MemoryNote; state: StoryState; held: boolean; onForget: () => void }) {
  const [text, setText] = useState(note.text);
  const changed = text.trim() !== note.text.trim();
  const stopped = state.saving !== null || held;
  const save = () => {
    void state.edit({ kind: 'note', id: note.id, text }, 'now');
  };
  let actions = null;
  if (changed) {
    actions = (
      <div className="notes-note-actions">
        <button type="button" className="btn btn-ghost" disabled={state.saving !== null} onClick={() => setText(note.text)}>
          Discard
        </button>
        <button type="button" className="btn btn-primary" disabled={stopped || text.trim() === ''} onClick={save}>
          Save
        </button>
      </div>
    );
  }
  return (
    <div className="notes-note">
      <div className="notes-note-row">
        <textarea
          className="add-text notes-note-box"
          value={text}
          maxLength={LONG_LIMIT}
          aria-label="A note in Procreator’s memory"
          onChange={(e) => setText(e.target.value)}
        />
        <button type="button" className="modal-close notes-forget" aria-label="Forget this note" disabled={stopped} onClick={onForget}>
          <IconTrash />
        </button>
      </div>
      {actions}
    </div>
  );
}

function NewNote({ state, held }: { state: StoryState; held: boolean }) {
  const [text, setText] = useState('');
  const stopped = state.saving !== null || held;
  const add = async () => {
    const kept = await state.edit({ kind: 'note', id: null, text }, 'now');
    if (kept) {
      setText('');
    }
  };
  return (
    <div className="notes-note">
      <textarea
        className="add-text notes-note-box"
        value={text}
        maxLength={LONG_LIMIT}
        placeholder="Something Procreator should keep in mind"
        aria-label="A new note for Procreator’s memory"
        onChange={(e) => setText(e.target.value)}
      />
      {text.trim() !== '' && (
        <div className="notes-note-actions">
          <button type="button" className="btn btn-primary" disabled={stopped} onClick={() => void add()}>
            Add the note
          </button>
        </div>
      )}
    </div>
  );
}
