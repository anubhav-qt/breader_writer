import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence } from 'motion/react';
import { everyone, SHORT_LIMIT, TITLE_LIMIT, type Character, type Relationship } from '@writer/shared/book';
import { blankRelationship, findRelationship, sidesInCastOrder } from '@writer/shared/setup';
import {
  PAGE_LIMIT,
  PLAN,
  THREADS,
  TIMELINE,
  type PageDraft,
  type PageKind,
  type Reach,
  type ReferencePage,
  type RewriteView,
  type StoryEdit,
  type StoryView,
} from '@writer/shared/story';
import { IconTrash } from '../../components/icons';
import { Modal } from '../../components/Modal';
import { blankCharacter, type Choice } from '../../data/setup';
import { fetchRewrite } from '../../data/story';
import { failureText } from '../../lib/api';
import { CharacterSheet } from '../setup/CharacterSheet';
import { ConfirmDialog } from '../setup/ConfirmDialog';
import { Choices, Field } from '../setup/Fields';
import { RelationshipSheet, nameIn } from '../setup/RelationshipSheet';
import { lineSaving, pageSaving, sheetSaving, unpageAsks, type SaveKind } from './reach';
import type { Opened, Saving, StoryState } from './useStory';
import '../add/add.css';
import '../setup/setup.css';
import './story.css';

/*
 * The sheets mid story (step 6), over the page: setup's own sheets, held until they're saved.
 * Once one has changed, its Save becomes "From now on" and "Always so", each with a line under it
 * saying what it does; a rename alone, or anything before the story is played, saves plainly (the
 * owner's picks, 2026-10-07 and 2026-10-11). Removing someone or untying two asks the same. A page
 * of the reference, from the Notes panel or someone's sheet, opens as a sheet too, and asks the
 * same, unless it says where the story is going (our call, 2026-10-15).
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
  } else if (story && opened?.kind === 'page') {
    const page = story.reference.find((each) => each.id === opened.id);
    // A page taken out since has nothing to show.
    if (page) {
      sheet = <PageSheet key={`page ${page.id}`} state={state} story={story} page={page} held={held} />;
    }
  } else if (story && opened?.kind === 'newPage') {
    sheet = <PageSheet key="new page" state={state} story={story} page={null} held={held} />;
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
      {how === 'asks' && <ReachChoice lines={lines} disabled={stopped || !canSave} onPick={onSave} />}
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
  // Where the owner goes once they say to leave what they changed: nowhere (closed), or another sheet.
  const [leaving, setLeaving] = useState<{ to: Opened | null } | null>(null);
  const make = async (edit: StoryEdit, reach: Reach) => {
    const kept = await state.edit(edit, reach);
    if (kept) {
      state.close();
    }
  };
  /** Leaves this sheet for another, or closes it, asking first when it has changes that weren't saved. */
  const leaveFor = (to: Opened | null) => {
    if (dirty && state.saving === null) {
      setLeaving({ to });
      return;
    }
    go(to);
  };
  const go = (to: Opened | null) => {
    if (to) {
      state.open(to);
    } else {
      state.close();
    }
  };
  const close = () => leaveFor(null);
  let leaveDialog = null;
  if (leaving) {
    leaveDialog = <LeaveDialog key="leave" onGo={() => go(leaving.to)} onClose={() => setLeaving(null)} />;
  }
  return { make, close, leaveFor, leaveDialog };
}

/** Procreator's page about someone, below the owner's sheet, to read; Edit opens it as a sheet of its own. */
function PageBlock({ text, onEdit }: { text: string; onEdit: (() => void) | null }) {
  if (text.trim() === '') {
    return null;
  }
  let edit = null;
  if (onEdit) {
    edit = (
      <button type="button" className="btn btn-ghost story-page-edit" onClick={onEdit}>
        Edit
      </button>
    );
  }
  return (
    <div className="setup-field story-page">
      <div className="story-page-head">
        <div className="add-label">Procreator’s page</div>
        {edit}
      </div>
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
  const theirPage = story.reference.find((page) => page.characterId === person.id);
  let editPage: (() => void) | null = null;
  if (theirPage) {
    editPage = () => sheet.leaveFor({ kind: 'page', id: theirPage.id });
  }
  const footer = (
    <>
      <PageBlock text={story.pages[person.id] ?? ''} onEdit={editPage} />
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

/** The kinds of page the owner can make, as radio cards. A character's page is in their sheet. */
const PAGE_KINDS: Choice<PageKind>[] = [
  { id: 'place', name: 'A place', about: 'A house, a city, a road.' },
  { id: 'group', name: 'A group', about: 'A family, a guild, a crew.' },
  { id: 'thing', name: 'A thing', about: 'An object that matters.' },
  { id: 'lore', name: 'Lore', about: 'The world’s history, rules, magic or customs.' },
  { id: 'story', name: 'The story’s own', about: 'Where it’s going, what it set up, what happened when.' },
];

/** The story's own pages keep their titles: Procreator looks for them by name. */
const OWN_TITLES = [PLAN, THREADS, TIMELINE].map((title) => title.toLowerCase());

function draftOf(page: ReferencePage | null): PageDraft {
  if (!page) {
    return { id: null, characterId: null, kind: 'place', title: '', about: '', body: '' };
  }
  return { id: page.id, characterId: page.characterId, kind: page.kind, title: page.title, about: page.about, body: page.body };
}

const PAGE_LINES: ReachLines = {
  now: 'It holds from here, and the story plays it as something that just came to light.',
  always: 'It was always so: what was played is rewritten to match.',
};

/**
 * A page of the reference, or a new one, over the page: its title and kind, what it holds, and the
 * page itself, in Procreator's Markdown with people in the cast as links (our call, 2026-10-15).
 */
function PageSheet({ state, story, page, held }: { state: StoryState; story: StoryView; page: ReferencePage | null; held: boolean }) {
  const [draft, setDraft] = useState<PageDraft>(() => draftOf(page));
  const [removing, setRemoving] = useState(false);
  const how = pageSaving(story.played, page, draft);
  const sheet = useSheet(state, how !== 'unchanged');
  const someones = draft.characterId !== null;
  const own = page !== null && OWN_TITLES.includes(page.title.toLowerCase());

  let title = 'A new page';
  if (page && someones) {
    title = `${page.title}’s page`;
  } else if (page) {
    title = page.title;
  }

  const save = (reach: Reach) => void sheet.make({ kind: 'page', page: draft }, reach);
  const remove = (reach: Reach) => {
    setRemoving(false);
    if (page) {
      void sheet.make({ kind: 'unpage', id: page.id }, reach);
    }
  };
  const askRemove = () => {
    if (page && unpageAsks(story.played, page)) {
      setRemoving(true);
    } else {
      remove('now');
    }
  };

  let left = null;
  if (page) {
    left = (
      <button type="button" className="btn btn-ghost sheet-remove" disabled={state.saving !== null || held} onClick={askRemove}>
        <IconTrash /> Take out
      </button>
    );
  }
  let canSave = draft.body.trim() !== '';
  if (!someones && draft.title.trim() === '') {
    canSave = false;
  }
  let saveLabel = 'Save';
  if (!page) {
    saveLabel = 'Add the page';
  }
  // A new page with nothing typed yet is just a sheet to close.
  let saving = how;
  if (!page && draft.title.trim() === '' && draft.body.trim() === '' && draft.about.trim() === '') {
    saving = 'unchanged';
  }

  // Someone's page goes by their name, and the story's own pages keep theirs: the sheet's title says it.
  let titleField = null;
  if (!someones && !own) {
    titleField = (
      <Field
        label="Title"
        value={draft.title}
        max={TITLE_LIMIT}
        autoFocus={!page}
        placeholder="The Lamp House, the Weavers’ Guild"
        onChange={(value) => setDraft({ ...draft, title: value })}
      />
    );
  }
  let kindField = null;
  if (!someones && !own) {
    kindField = <Choices label="Kind" choices={PAGE_KINDS} value={draft.kind} onPick={(kind) => setDraft({ ...draft, kind })} />;
  }
  const removeLines: ReachLines = {
    now: 'It’s gone from here. What was played stays.',
    always: 'It was never so: what was played is rewritten without it.',
  };

  return (
    <>
      <Modal title={title} onClose={sheet.close} width={600}>
        <div className="add sheet page-sheet">
          {titleField}
          {kindField}
          <Field label="What it holds" value={draft.about} max={SHORT_LIMIT} placeholder="One line for the index" onChange={(about) => setDraft({ ...draft, about })} />
          <Field label="The page" size="notes" value={draft.body} max={PAGE_LIMIT} placeholder="What the story knows about it" onChange={(body) => setDraft({ ...draft, body })} />
          <SheetFooter
            state={state}
            held={held}
            how={saving}
            lines={PAGE_LINES}
            note="People in the cast are written [[Name]], so a rename reaches them."
            left={left}
            saveLabel={saveLabel}
            canSave={canSave}
            onSave={save}
            onDone={state.close}
          />
        </div>
      </Modal>
      <AnimatePresence>
        {removing && <ReachDialog key="unpage" title={`Take out ${title}?`} lines={removeLines} onPick={remove} onClose={() => setRemoving(false)} />}
        {sheet.leaveDialog}
      </AnimatePresence>
    </>
  );
}
