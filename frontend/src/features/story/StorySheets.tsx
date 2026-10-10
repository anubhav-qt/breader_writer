import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence } from 'motion/react';
import { everyone, type Character, type Relationship } from '@writer/shared/book';
import { blankRelationship, findRelationship, sidesInCastOrder } from '@writer/shared/setup';
import type { Reach, RewriteView, StoryEdit, StoryView } from '@writer/shared/story';
import { IconTrash } from '../../components/icons';
import { Modal } from '../../components/Modal';
import { blankCharacter } from '../../data/setup';
import { fetchRewrite } from '../../data/story';
import { failureText } from '../../lib/api';
import { CharacterSheet } from '../setup/CharacterSheet';
import { ConfirmDialog } from '../setup/ConfirmDialog';
import { RelationshipSheet, nameIn } from '../setup/RelationshipSheet';
import { lineSaving, sheetSaving, type SaveKind } from './reach';
import type { Saving, StoryState } from './useStory';
import '../add/add.css';
import '../setup/setup.css';
import './story.css';

/*
 * The sheets mid story (step 6), over the page: setup's own sheets, held until they're saved.
 * Once one has changed, its Save becomes "From now on" and "Always so", each with a line under it
 * saying what it does; a rename alone, or anything before the story is played, saves plainly (the
 * owner's picks, 2026-10-07 and 2026-10-11). Removing someone or untying two asks the same.
 */

/** What each of the two buttons does, as the line under it says. */
interface ReachLines {
  now: string;
  always: string;
}

const CHANGE_LINES: ReachLines = {
  now: 'It changes here, and the story plays it as something that just happened.',
  always: 'It was always so: what was played is rewritten to match.',
};

const RENAME_LINES: ReachLines = {
  now: 'The new name reaches back. The rest changes here, as something that just happened.',
  always: 'It was always so: the name and the rest are rewritten into what was played.',
};

interface SheetsProps {
  state: StoryState;
  bookId: string;
  /** Procreator is writing in the book, so nothing can be saved until it's done. */
  held: boolean;
}

/** The sheet open over the page, from the Story panel or a quiet line in the play's page. */
export function StorySheets({ state, bookId, held }: SheetsProps) {
  const story = state.story;
  const opened = state.opened;
  let sheet: ReactNode = null;
  if (opened?.kind === 'rewrite') {
    sheet = <RewriteSheet key={`rewrite ${opened.change}`} bookId={bookId} change={opened.change} onClose={state.close} />;
  } else if (story && opened?.kind === 'person') {
    const person = everyone(story.setup).find((someone) => someone.id === opened.id);
    // Someone who has left the story since has no sheet in it.
    if (person) {
      sheet = <PersonSheet key={`person ${person.id}`} state={state} story={story} person={person} held={held} />;
    }
  } else if (story && opened?.kind === 'new') {
    sheet = <NewPersonSheet key="new" state={state} story={story} held={held} />;
  } else if (story && opened?.kind === 'line') {
    sheet = <LineSheet key={`line ${opened.a} ${opened.b}`} state={state} story={story} a={opened.a} b={opened.b} held={held} />;
  }
  return <AnimatePresence>{sheet}</AnimatePresence>;
}

/** A change on its way: saving, or Procreator rewriting what was played, a part at a time. */
export function SavingLine({ saving }: { saving: Saving }) {
  let text = 'Saving';
  if (saving.of > 0 && saving.done < saving.of) {
    text = `Procreator is rewriting what was played, part ${saving.done + 1} of ${saving.of}`;
  } else if (saving.of > 0) {
    text = 'Keeping what Procreator rewrote';
  }
  return (
    <div className="add-busy story-saving" role="status">
      <span className="add-spinner" aria-hidden="true" />
      {text}
    </div>
  );
}

/** "From now on" and "Always so", each with a line under it saying what it does. */
export function ReachChoice({ lines, disabled, onPick }: { lines: ReachLines; disabled: boolean; onPick: (reach: Reach) => void }) {
  return (
    <div className="reach">
      <div className="reach-option">
        <button type="button" className="btn btn-primary" disabled={disabled} onClick={() => onPick('now')}>
          From now on
        </button>
        <p className="reach-line">{lines.now}</p>
      </div>
      <div className="reach-option">
        <button type="button" className="btn btn-quiet" disabled={disabled} onClick={() => onPick('always')}>
          Always so
        </button>
        <p className="reach-line">{lines.always}</p>
      </div>
    </div>
  );
}

/** Why the change wasn't kept, the change on its way, or why it can't be saved yet. */
export function SaveStatus({ state, held, changed }: { state: StoryState; held: boolean; changed: boolean }) {
  if (state.saving) {
    return <SavingLine saving={state.saving} />;
  }
  if (state.error) {
    return (
      <p className="setup-note is-error story-error" role="alert">
        {state.error}
      </p>
    );
  }
  if (held && changed) {
    return <p className="add-found">Procreator is writing in the book. Save once it’s done.</p>;
  }
  return null;
}

interface FooterProps {
  state: StoryState;
  held: boolean;
  how: SaveKind;
  lines: ReachLines;
  /** A line over the buttons, like what the sheet's Save does. */
  note?: string;
  /** Remove or Untie, on the left. */
  left?: ReactNode;
  saveLabel?: string;
  /** Whether a plain Save may be pressed, like someone new only once they have a name. */
  canSave?: boolean;
  onSave: (reach: Reach) => void;
  onDone: () => void;
}

/** What's under a sheet's fields mid story: its buttons as the change asks, and how the change stands. */
function SheetFooter({ state, held, how, lines, note, left, saveLabel = 'Save', canSave = true, onSave, onDone }: FooterProps) {
  const stopped = state.saving !== null || held;
  let done = null;
  if (how === 'plain') {
    done = (
      <button type="button" className="btn btn-primary" disabled={stopped || !canSave} onClick={() => onSave('now')}>
        {saveLabel}
      </button>
    );
  } else if (how === 'unchanged') {
    done = (
      <button type="button" className="btn btn-primary" onClick={onDone}>
        Done
      </button>
    );
  }
  let row = null;
  if (left || done) {
    row = (
      <div className="add-actions sheet-actions">
        {left}
        {done}
      </div>
    );
  }
  // How the change stands goes just above the buttons, where the owner's eye is.
  return (
    <>
      {note && <p className="add-found">{note}</p>}
      <SaveStatus state={state} held={held} changed={how !== 'unchanged'} />
      {how === 'asks' && <ReachChoice lines={lines} disabled={stopped} onPick={onSave} />}
      {row}
    </>
  );
}

/** Asks how far back removing someone or untying two reaches. */
function ReachDialog({ title, lines, onPick, onClose }: { title: string; lines: ReachLines; onPick: (reach: Reach) => void; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose} width={460}>
      <div className="add">
        <ReachChoice lines={lines} disabled={false} onPick={onPick} />
        <div className="add-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Asks before closing a sheet with changes that weren't saved. */
function LeaveDialog({ onGo, onClose }: { onGo: () => void; onClose: () => void }) {
  return (
    <ConfirmDialog
      title="Close without saving?"
      text="What you changed here won’t be kept."
      go="Close"
      stay="Keep editing"
      onGo={onGo}
      onClose={onClose}
    />
  );
}

/** The parts of a sheet's life every sheet shares: making the change, and closing with or without asking. */
function useSheet(state: StoryState, dirty: boolean) {
  const [leaving, setLeaving] = useState(false);
  const make = async (edit: StoryEdit, reach: Reach) => {
    const kept = await state.edit(edit, reach);
    if (kept) {
      state.close();
    }
  };
  const close = () => {
    if (dirty && state.saving === null) {
      setLeaving(true);
      return;
    }
    state.close();
  };
  const leaveDialog = leaving && <LeaveDialog key="leave" onGo={state.close} onClose={() => setLeaving(false)} />;
  return { make, close, leaveDialog };
}

/** Procreator's page about someone, below the owner's sheet. It's edited in the Notes panel. */
function PageBlock({ text }: { text: string }) {
  if (text.trim() === '') {
    return null;
  }
  return (
    <div className="setup-field story-page">
      <div className="add-label">Procreator’s page</div>
      <div className="story-page-text">{text}</div>
    </div>
  );
}

interface PersonProps {
  state: StoryState;
  story: StoryView;
  person: Character;
  held: boolean;
}

function PersonSheet({ state, story, person, held }: PersonProps) {
  const [draft, setDraft] = useState(person);
  const [removing, setRemoving] = useState(false);
  const how = sheetSaving(story.played, person, draft);
  const sheet = useSheet(state, how !== 'unchanged');
  const plays = person.id === story.setup.protagonist.id;
  const name = person.name;

  let lines = CHANGE_LINES;
  if (draft.name.trim() !== name) {
    lines = RENAME_LINES;
  }
  const save = (reach: Reach) => void sheet.make({ kind: 'sheet', character: draft }, reach);
  const remove = (reach: Reach) => {
    setRemoving(false);
    void sheet.make({ kind: 'leave', id: person.id }, reach);
  };
  // Before anything is played there's no past, so someone is just taken out.
  const askRemove = () => {
    if (story.played) {
      setRemoving(true);
    } else {
      remove('now');
    }
  };

  let left = null;
  if (!plays) {
    left = (
      <button type="button" className="btn btn-ghost sheet-remove" disabled={state.saving !== null || held} onClick={askRemove}>
        <IconTrash /> Remove
      </button>
    );
  }
  const footer = (
    <>
      <PageBlock text={story.pages[person.id] ?? ''} />
      <SheetFooter state={state} held={held} how={how} lines={lines} left={left} onSave={save} onDone={state.close} />
    </>
  );
  const removeLines: ReachLines = {
    now: `${name} leaves the story here. What was played stays.`,
    always: `${name} was never in it: what was played is rewritten without them.`,
  };

  return (
    <>
      <CharacterSheet character={draft} plays={plays} onChange={setDraft} onRemove={askRemove} onClose={sheet.close} footer={footer} />
      <AnimatePresence>
        {removing && (
          <ReachDialog key="remove" title={`Take ${name} out of the story?`} lines={removeLines} onPick={remove} onClose={() => setRemoving(false)} />
        )}
        {sheet.leaveDialog}
      </AnimatePresence>
    </>
  );
}

/** Someone new, with a sheet the owner writes: they join from here. */
function NewPersonSheet({ state, story, held }: { state: StoryState; story: StoryView; held: boolean }) {
  const [draft, setDraft] = useState(blankCharacter);
  const typed = JSON.stringify({ ...draft, id: '' }) !== JSON.stringify({ ...blankCharacter(), id: '' });
  const sheet = useSheet(state, typed);
  let note = 'Only the name is needed. The story fills in the rest.';
  if (story.played) {
    note = 'They join the story from here. Only the name is needed: the story fills in the rest.';
  }
  const footer = (
    <SheetFooter
      state={state}
      held={held}
      how="plain"
      lines={CHANGE_LINES}
      note={note}
      saveLabel="Add to the story"
      canSave={draft.name.trim() !== ''}
      onSave={() => void sheet.make({ kind: 'join', character: draft }, 'now')}
      onDone={state.close}
    />
  );
  return (
    <>
      <CharacterSheet character={draft} plays={false} onChange={setDraft} onRemove={sheet.close} onClose={sheet.close} footer={footer} />
      <AnimatePresence>{sheet.leaveDialog}</AnimatePresence>
    </>
  );
}

interface LineProps {
  state: StoryState;
  story: StoryView;
  a: string;
  b: string;
  held: boolean;
}

/** The line between two, or a new one: tying them is saved like any change. */
function LineSheet({ state, story, a, b, held }: LineProps) {
  const setup = story.setup;
  const was = findRelationship(setup, a, b);
  const [draft, setDraft] = useState<Relationship>(() => was ?? blankRelationship(a, b));
  const [untying, setUntying] = useState(false);
  const how = lineSaving(story.played, was, draft);
  const typed = JSON.stringify(draft) !== JSON.stringify(was ?? blankRelationship(a, b));
  const sheet = useSheet(state, typed);
  const people = everyone(setup);
  const protagonistId = setup.protagonist.id;
  const [first, second] = sidesInCastOrder(draft, people);
  const between = `${nameIn(people, first.id, protagonistId)} and ${nameIn(people, second.id, protagonistId)}`;

  const save = (reach: Reach) => void sheet.make({ kind: 'line', relationship: draft }, reach);
  const untie = (reach: Reach) => {
    setUntying(false);
    void sheet.make({ kind: 'untie', a, b }, reach);
  };
  const askUntie = () => {
    if (story.played) {
      setUntying(true);
    } else {
      untie('now');
    }
  };

  let left = null;
  // A line that isn't tied yet has nothing to untie: closing it leaves them as they were.
  if (was) {
    left = (
      <button type="button" className="btn btn-ghost sheet-remove" disabled={state.saving !== null || held} onClick={askUntie}>
        <IconTrash /> Untie
      </button>
    );
  }
  let note: string | undefined;
  if (!was) {
    note = `${between} aren’t tied yet. Saving ties them.`;
  }
  const footer = <SheetFooter state={state} held={held} how={how} lines={CHANGE_LINES} note={note} left={left} onSave={save} onDone={state.close} />;
  const untieLines: ReachLines = {
    now: 'They stop being tied here. What happened between them stays.',
    always: 'They were never tied: what was played is rewritten to match.',
  };

  return (
    <>
      <RelationshipSheet
        relationship={draft}
        people={people}
        protagonistId={protagonistId}
        onChange={setDraft}
        onUntie={askUntie}
        onClose={sheet.close}
        footer={footer}
      />
      <AnimatePresence>
        {untying && <ReachDialog key="untie" title={`Untie ${between}?`} lines={untieLines} onPick={untie} onClose={() => setUntying(false)} />}
        {sheet.leaveDialog}
      </AnimatePresence>
    </>
  );
}

/** What a change that reached back rewrote, each passage before and after (the owner's pick, 2026-10-11). */
function RewriteSheet({ bookId, change, onClose }: { bookId: string; change: number; onClose: () => void }) {
  const [view, setView] = useState<RewriteView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchRewrite(bookId, change)
      .then((found) => {
        if (live) setView(found);
      })
      .catch((e) => {
        if (live) setError(failureText(e));
      });
    return () => {
      live = false;
    };
  }, [bookId, change]);

  let title = 'What was rewritten';
  let body: ReactNode = (
    <div className="add-busy" role="status">
      <span className="add-spinner" aria-hidden="true" />
      Reading what was rewritten
    </div>
  );
  if (error) {
    body = (
      <p className="setup-note is-error" role="alert">
        {error}
      </p>
    );
  } else if (view) {
    title = view.what;
    body = (
      <>
        <p className="add-found">{passagesText(view.passages.length)} rewritten, each as it was and as it is now.</p>
        {view.passages.map((passage, index) => (
          <section key={index} className="rewrite-passage">
            <div className="add-label">{passage.where}</div>
            <div className="rewrite-text is-before">
              <span className="rewrite-tag">Before</span>
              <p>{passage.before}</p>
            </div>
            <div className="rewrite-text">
              <span className="rewrite-tag">After</span>
              <p>{passage.after || 'Taken out.'}</p>
            </div>
          </section>
        ))}
      </>
    );
  }

  return (
    <Modal title={title} onClose={onClose} width={600}>
      <div className="add rewrite">
        {body}
        <div className="add-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** "1 passage", "3 passages". */
export function passagesText(count: number): string {
  if (count === 1) {
    return '1 passage';
  }
  return `${count} passages`;
}
