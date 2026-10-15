import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence } from 'motion/react';
import type { Mark, Opening, Person, Play, PlayTurn, SceneHead } from '@writer/shared/play';
import { IconBack, IconClose, IconNotes, IconPeople, IconUndo } from '../../components/icons';
import { useMedia } from '../../lib/useMedia';
import { ModelPicker } from '../models/ModelPicker';
import { NotesPanel } from '../story/NotesPanel';
import { StoryPanel } from '../story/StoryPanel';
import { SavingLine, StorySheets, passagesText } from '../story/StorySheets';
import { useStory, type StoryState } from '../story/useStory';
import { MoveBox, type Draft } from './MoveBox';
import { newestOf, usePlay, type Pending, type PlayState } from './usePlay';
import '../add/add.css';
import './play.css';

/*
 * The play (step 6). It reads like a book page (the owner's picks, 2026-10-07): Procreator's
 * narration flows as prose in one centred column, the owner's moves sit between its paragraphs as
 * quiet italic lines, and the box for a move is pinned at the bottom. The page holds only the
 * scene being played, under its heading; when it ends, the page starts fresh under the next one's.
 */

interface Props {
  bookId: string;
  /** Whether the account is the owner, for the model picker's AI accounts. */
  owner: boolean;
  onClose: () => void;
}

/** How near the end the owner has to be for the page to keep to the end as words come in. */
const NEAR_END = 120;

/** Wide enough for the Story and Notes panels to sit beside the play instead of over it. */
const WIDE = '(min-width: 1100px)';

/** The panel open beside the play, if one is: the Story panel or the Notes panel, one at a time. */
type PanelName = 'story' | 'notes';

const BLANK_DRAFT: Draft = { text: '', voice: 'character' };

/** The owner's words put back in the box, before anything typed there since. */
function withWordsBack(words: string, box: string): string {
  if (box.trim() === '') {
    return words;
  }
  return `${words}\n\n${box}`;
}

export function PlayPage({ bookId, owner, onClose }: Props) {
  // The story's changes and the play's moves wait for each other: one exchange at a time in a book.
  const refreshPlay = useRef<() => Promise<void>>(async () => {});
  const story = useStory(bookId, () => void refreshPlay.current());
  const state = usePlay(bookId, story.saving !== null);
  refreshPlay.current = state.refresh;
  const [draft, setDraft] = useState<Draft>(BLANK_DRAFT);
  const [playingCue, setPlayingCue] = useState(false);
  const [panel, setPanel] = useState<PanelName | null>(null);
  const wide = useMedia(WIDE);
  const play = state.play;
  const writing = state.pending !== null || state.asking !== null;

  // The story is read again as a panel or a sheet opens, and whenever the play changed.
  const showing = panel !== null || story.opened !== null;
  useEffect(() => {
    if (showing) {
      void story.reload();
    }
    // reload is made anew each render; what matters is what's showing and the play.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showing, play]);

  /** A quiet line in the page opens what it's about: someone's sheet, a line's, or what a rewrite changed. */
  const openMark = (mark: Mark) => {
    if (mark.kind === 'joined') {
      story.open({ kind: 'person', id: mark.id });
    } else if (mark.kind === 'shifted') {
      story.open({ kind: 'line', a: mark.a, b: mark.b });
    } else {
      story.open({ kind: 'rewrite', change: mark.change });
    }
  };

  // A cue is asked about afresh each time someone is about to act.
  const cueId = play?.cue?.id ?? null;
  useEffect(() => {
    setPlayingCue(false);
  }, [cueId]);

  /** Opens a panel, or closes it when it's the one open. */
  const togglePanel = (name: PanelName) => {
    if (panel === name) {
      setPanel(null);
    } else {
      setPanel(name);
    }
  };

  const putBack = (words: string, voice: Draft['voice']) => {
    setDraft((now) => ({ text: withWordsBack(words, now.text), voice }));
  };

  const send = async () => {
    if (!play) {
      return;
    }
    const words = draft.text.trim();
    const voice = draft.voice;
    // After a note, the box goes back to the owner's character.
    setDraft({ text: '', voice: 'character' });
    let landed = false;
    if (play.stage === 'openings') {
      landed = await state.ownOpening(words);
    } else if (play.stage === 'cue') {
      landed = await state.move('character', words, play.cue);
    } else {
      landed = await state.move(voice, words, null);
    }
    // The server took the move back, so the words are still the owner's.
    if (!landed) {
      putBack(words, voice);
    }
  };

  const undo = async () => {
    const undone = await state.undo();
    if (!undone || undone.words === '') {
      return;
    }
    if (undone.voice === 'author') {
      putBack(undone.words, 'author');
      return;
    }
    if (undone.voice === 'opening') {
      // One of the openings offered is there to pick again; the owner's own goes back in the box.
      const offered = undone.play.openings ?? [];
      const picked = offered.some((opening) => opening.text === undone.words);
      if (!picked) {
        putBack(undone.words, 'character');
      }
      return;
    }
    putBack(undone.words, 'character');
  };

  let title = '';
  if (play) {
    title = play.title;
  }

  return (
    <div className="play">
      <header className="play-bar">
        <button type="button" className="modal-close play-back" onClick={onClose} aria-label="Back to the library">
          <IconBack />
        </button>
        <h1 className="play-title">{title}</h1>
        <div className="play-actions">
          <button
            type="button"
            className="btn btn-ghost play-tool"
            disabled={!canUndo(state)}
            aria-label="Undo the last turn"
            onClick={() => void undo()}
          >
            <IconUndo /> <span className="play-tool-label">Undo</span>
          </button>
          <button
            type="button"
            className="btn btn-ghost play-tool"
            aria-label="Story"
            aria-expanded={panel === 'story'}
            onClick={() => togglePanel('story')}
          >
            <IconPeople /> <span className="play-tool-label">Story</span>
          </button>
          <button
            type="button"
            className="btn btn-ghost play-tool"
            aria-label="Notes"
            aria-expanded={panel === 'notes'}
            onClick={() => togglePanel('notes')}
          >
            <IconNotes /> <span className="play-tool-label">Notes</span>
          </button>
          <ModelPicker owner={owner} />
        </div>
      </header>

      <PageBody state={state} onMark={openMark} />

      <footer className="play-foot">
        <div className="play-foot-inner">
          <Foot state={state} story={story} showing={showing} onHint={(move) => setDraft({ text: move, voice: 'character' })} />
          {play && (
            <MoveBox
              stage={play.stage}
              protagonist={play.protagonist}
              cue={play.cue}
              playingCue={playingCue}
              draft={draft}
              onDraft={setDraft}
              busy={state.busy}
              playOthers={state.playOthers}
              onPlayOthers={state.changePlayOthers}
              onHints={() => void state.askForHints()}
              onPlayCue={() => setPlayingCue(true)}
              onActorPlays={() => void state.letActor()}
              onCueAgain={() => setPlayingCue(false)}
              onSend={() => void send()}
            />
          )}
        </div>
      </footer>

      <AnimatePresence>
        {panel === 'story' && (
          <StoryPanel key={wide ? 'story panel' : 'story sheet'} state={story} wide={wide} held={writing} onClose={() => setPanel(null)} />
        )}
        {panel === 'notes' && (
          <NotesPanel key={wide ? 'notes panel' : 'notes sheet'} state={story} wide={wide} held={writing} onClose={() => setPanel(null)} />
        )}
      </AnimatePresence>
      <StorySheets state={story} bookId={bookId} held={writing} />
    </div>
  );
}

/** Whether the newest turn can be taken back: a later scene's opening can only be written again. */
function canUndo(state: PlayState): boolean {
  const play = state.play;
  if (!play || state.busy) {
    return false;
  }
  const newest = newestOf(play.turns);
  if (!newest) {
    return false;
  }
  if (newest.voice === 'opening' && play.scene && play.scene.number > 1) {
    return false;
  }
  return true;
}

interface FootProps {
  state: PlayState;
  story: StoryState;
  /** Whether a panel or a sheet is open, and says how a change stands itself. */
  showing: boolean;
  onHint: (move: string) => void;
}

/** What's above the box: why something failed, a change to the story on its way, the hints, or Procreator thinking of them. */
function Foot({ state, story, showing, onHint }: FootProps) {
  let error = null;
  if (story.saving) {
    error = <SavingLine saving={story.saving} />;
  } else if (story.error && !showing) {
    error = (
      <p className="play-error" role="alert">
        {story.error}
      </p>
    );
  } else if (state.error) {
    error = (
      <p className="play-error" role="alert">
        {state.error}
      </p>
    );
  }
  let hints = null;
  if (state.asking === 'hints') {
    hints = <Working text="Procreator is thinking of moves" />;
  } else if (state.hints) {
    hints = (
      <div className="play-hints">
        <div className="play-hints-list">
          {state.hints.map((move, index) => (
            <button key={index} type="button" className="play-hint" onClick={() => onHint(move)}>
              {move}
            </button>
          ))}
        </div>
        <button type="button" className="modal-close play-hints-close" aria-label="Hide the hints" onClick={state.hideHints}>
          <IconClose />
        </button>
      </div>
    );
  }
  return (
    <>
      {error}
      {hints}
    </>
  );
}

/** The scrolling page: the scene's heading and its turns, and what Procreator is writing now. */
function PageBody({ state, onMark }: { state: PlayState; onMark: (mark: Mark) => void }) {
  const scrollRef = useRef<HTMLElement>(null);
  const nearEnd = useRef(true);
  const pending = state.pending;
  const play = state.play;

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    nearEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_END;
  };

  // Sending something takes the page to its end, and a new scene to its top.
  const sending = pending !== null;
  const fresh = pending?.fresh === true;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !sending) {
      return;
    }
    nearEnd.current = true;
    if (fresh) {
      el.scrollTop = 0;
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, [sending, fresh]);

  // As words come in, the page keeps to its end, unless the owner scrolled up to read.
  const reply = pending?.reply ?? '';
  const turns = play?.turns.length ?? 0;
  const stage = play?.stage;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && nearEnd.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [reply, turns, stage, state.asking]);

  let content: ReactNode = null;
  if (state.loaded.state === 'failed') {
    content = <p className="play-error play-failed">{state.loaded.message}</p>;
  } else if (play) {
    content = <ScenePage play={play} state={state} onMark={onMark} />;
  }

  return (
    <main className="play-scroll" ref={scrollRef} onScroll={onScroll}>
      <article className="play-page">{content}</article>
    </main>
  );
}

/** The scene on the page: its heading, its turns, and what's under them as the play stands. */
function ScenePage({ play, state, onMark }: { play: Play; state: PlayState; onMark: (mark: Mark) => void }) {
  const pending = state.pending;

  // Going on: the page starts fresh under the next scene's heading.
  if (pending && pending.fresh) {
    let head = pending.scene;
    if (!head) {
      head = play.next;
    }
    return (
      <>
        <SceneHeading scene={head} />
        <PendingView pending={pending} protagonist={play.protagonist} />
      </>
    );
  }

  let head = play.scene;
  if (pending && pending.scene) {
    head = pending.scene;
  }
  if (!head && (play.stage === 'start' || play.stage === 'openings')) {
    head = { number: 1, place: '', time: '' };
  }

  let turns = play.turns;
  if (pending && pending.redoing) {
    turns = turns.filter((turn) => turn.id !== pending.redoing);
  }
  const newest = newestOf(turns);

  let under: ReactNode = null;
  if (pending) {
    under = <PendingView pending={pending} protagonist={play.protagonist} />;
  } else if (play.stage === 'start') {
    under = <StartView state={state} />;
  } else if (play.stage === 'openings' && play.openings) {
    under = <OpeningsView openings={play.openings} state={state} />;
  } else if (play.stage === 'opening') {
    under = <NotOpened play={play} state={state} />;
  } else if (play.stage === 'ended') {
    under = <SceneEnd play={play} state={state} />;
  }

  let canAgain = false;
  if (!state.busy && (play.stage === 'playing' || play.stage === 'cue' || play.stage === 'ended')) {
    canAgain = true;
  }

  return (
    <>
      <SceneHeading scene={head} />
      {turns.map((turn) => (
        <TurnView
          key={turn.id}
          turn={turn}
          protagonist={play.protagonist}
          again={canAgain && turn === newest}
          onAgain={() => void state.again()}
          onMark={onMark}
        />
      ))}
      {under}
    </>
  );
}

/** Where and when a scene takes place, as one line. */
function whereAndWhen(scene: SceneHead): string {
  const parts: string[] = [];
  if (scene.place.trim()) {
    parts.push(scene.place.trim());
  }
  if (scene.time.trim()) {
    parts.push(scene.time.trim());
  }
  return parts.join(', ');
}

/** The scene's number, over where and when it takes place (the owner's pick, 2026-10-07). */
function SceneHeading({ scene }: { scene: SceneHead | null }) {
  if (!scene) {
    return null;
  }
  const where = whereAndWhen(scene);
  return (
    <header className="play-head">
      <span className="play-head-number">Scene {scene.number}</span>
      {where && <h2 className="play-head-where">{where}</h2>}
    </header>
  );
}

/** Paragraphs of prose, one for each line with words on it. */
function Prose({ text }: { text: string }) {
  const paragraphs: string[] = [];
  for (const line of text.split('\n')) {
    const paragraph = line.trim();
    if (paragraph) {
      paragraphs.push(paragraph);
    }
  }
  if (paragraphs.length === 0) {
    return null;
  }
  return (
    <div className="play-prose">
      {paragraphs.map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </div>
  );
}

/** The owner's move, a quiet italic line, with who they played when it wasn't their character. */
function MoveLine({ text, played, protagonist }: { text: string; played: Person | null; protagonist: Person }) {
  let as = null;
  if (played && played.id !== protagonist.id) {
    as = <span className="chip play-as">as {played.name}</span>;
  }
  return (
    <p className="play-move">
      {as}
      {text}
    </p>
  );
}

/**
 * A note as the author, or the owner's pick of how the story opens: shown while Procreator answers
 * it, then folded into a small mark a tap opens again (the owner's pick, 2026-10-07).
 */
function NoteMark({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  let note = null;
  if (open) {
    note = <p className="play-note">{text}</p>;
  }
  return (
    <div className="play-note-wrap">
      <button type="button" className="chip play-note-mark" aria-expanded={open} onClick={() => setOpen(!open)}>
        {label}
      </button>
      {note}
    </div>
  );
}

/** What the owner sent, as the page shows it. */
function InputView({ voice, input, played, protagonist, folded }: {
  voice: PlayTurn['voice'];
  input: string;
  played: Person | null;
  protagonist: Person;
  /** A note folds away once Procreator has answered it. */
  folded: boolean;
}) {
  if (input.trim() === '') {
    return null;
  }
  if (voice === 'character') {
    return <MoveLine text={input} played={played} protagonist={protagonist} />;
  }
  let label = '';
  if (voice === 'author') {
    label = 'Author’s note';
  } else if (voice === 'opening') {
    label = 'Opening';
  } else {
    // An actor's answer is Procreator's to write from, never the page's.
    return null;
  }
  if (!folded) {
    return <p className="play-note">{input}</p>;
  }
  return <NoteMark label={label} text={input} />;
}

/**
 * A quiet line for someone joining the cast or a relationship shifting, and a tap opens that sheet
 * (the owner's pick, 2026-10-07); or for a rewrite of the past, and a tap shows each passage before
 * and after (the owner's pick, 2026-10-11).
 */
function MarkLine({ mark, onOpen }: { mark: Mark; onOpen: (mark: Mark) => void }) {
  let text = '';
  if (mark.kind === 'joined') {
    text = `${mark.name} joins the cast`;
  } else if (mark.kind === 'shifted') {
    text = `${mark.between}: ${mark.text}`;
  } else {
    text = `${mark.what}: ${passagesText(mark.count)} rewritten`;
  }
  return (
    <button type="button" className="play-mark" onClick={() => onOpen(mark)}>
      {text}
    </button>
  );
}

interface TurnProps {
  turn: PlayTurn;
  protagonist: Person;
  /** Whether "Another reply" sits under it: the newest reply, while nothing is being written. */
  again: boolean;
  onAgain: () => void;
  onMark: (mark: Mark) => void;
}

function TurnView({ turn, protagonist, again, onAgain, onMark }: TurnProps) {
  return (
    <section className="play-turn">
      <InputView voice={turn.voice} input={turn.input} played={turn.played} protagonist={protagonist} folded />
      <Prose text={turn.reply} />
      {turn.marks.map((mark, index) => (
        <MarkLine key={index} mark={mark} onOpen={onMark} />
      ))}
      {again && (
        <button type="button" className="btn btn-ghost play-again" onClick={onAgain}>
          Another reply
        </button>
      )}
    </section>
  );
}

/** A spinner and what's happening, quietly. */
function Working({ text }: { text: string }) {
  return (
    <div className="add-busy play-working" role="status">
      <span className="add-spinner" aria-hidden="true" />
      {text}
    </div>
  );
}

/** What was sent, and Procreator's words as they come; until the first, a line says it's working. */
function PendingView({ pending, protagonist }: { pending: Pending; protagonist: Person }) {
  let working = null;
  if (pending.reply.trim() === '' && pending.finishing !== null) {
    working = <Working text={`Finishing Scene ${pending.finishing} for the book`} />;
  } else if (pending.reply.trim() === '') {
    working = <Working text="Procreator is writing" />;
  }
  return (
    <section className="play-turn">
      <InputView voice={pending.voice} input={pending.input} played={pending.played} protagonist={protagonist} folded={false} />
      <Prose text={pending.reply} />
      {working}
    </section>
  );
}

/** A story that hasn't started: Procreator thinks of three openings, or says why it couldn't. */
function StartView({ state }: { state: PlayState }) {
  if (state.asking === 'openings') {
    return <Working text="Procreator is thinking of three openings" />;
  }
  if (!state.error) {
    return null;
  }
  return (
    <div className="play-end">
      <button type="button" className="btn btn-quiet" disabled={state.busy} onClick={() => void state.askForOpenings()}>
        Ask for openings again
      </button>
    </div>
  );
}

/** The three openings offered: one tap opens the story with it (the owner's pick, 2026-10-07). */
function OpeningsView({ openings, state }: { openings: Opening[]; state: PlayState }) {
  return (
    <div className="play-openings">
      <p className="play-quiet">Pick how the story opens, or write your own below.</p>
      <div className="add-choices">
        {openings.map((opening, index) => {
          const where = whereAndWhen({ number: 1, place: opening.place, time: opening.time });
          return (
            <button
              key={index}
              type="button"
              className="add-choice play-opening"
              disabled={state.busy}
              onClick={() => void state.pickOpening(index)}
            >
              <span className="play-opening-text">{opening.text}</span>
              {where && <span className="play-opening-where">{where}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A scene that began but couldn't be opened: going on opens it again. */
function NotOpened({ play, state }: { play: Play; state: PlayState }) {
  let number = 0;
  if (play.scene) {
    number = play.scene.number;
  }
  return (
    <div className="play-end">
      <p className="play-quiet">Scene {number} hasn’t opened yet.</p>
      <button type="button" className="btn btn-primary play-on" disabled={state.busy} onClick={() => void state.goOn()}>
        Open Scene {number}
      </button>
    </div>
  );
}

/**
 * A scene that ended: it's going into the book, and the next waits for the owner. Until they go
 * on, the box waits and undo still works (the owner's pick, 2026-10-07).
 */
function SceneEnd({ play, state }: { play: Play; state: PlayState }) {
  let number = 0;
  if (play.scene) {
    number = play.scene.number;
  }
  let on = null;
  if (play.next) {
    on = (
      <button type="button" className="btn btn-primary play-on" disabled={state.busy} onClick={() => void state.goOn()}>
        On to Scene {play.next.number}
      </button>
    );
  }
  return (
    <div className="play-end">
      <p className="play-quiet">End of Scene {number}. It’s going into the book.</p>
      {on}
    </div>
  );
}
