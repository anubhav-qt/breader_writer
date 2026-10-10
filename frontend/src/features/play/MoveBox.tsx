import { type KeyboardEvent } from 'react';
import { LONG_LIMIT } from '@writer/shared/book';
import type { MoveVoice, Person, Stage } from '@writer/shared/play';

/*
 * The box for a move, pinned at the bottom of the play (the owner's picks, 2026-10-07): a chip at
 * its top left says who the owner writes as, and one tap switches it to the author, which turns
 * the box grey and italic. Its bottom row has Hints on the left, the switch "Main character and
 * author only", and Send on the right. When someone in the cast is about to act and the switch is
 * off, the box asks who plays them.
 */

/** What's in the box: the owner's words, and whether they're a move or a note as the author. */
export interface Draft {
  text: string;
  voice: MoveVoice;
}

interface Props {
  stage: Stage;
  protagonist: Person;
  /** Who is about to act, while the owner says who plays them. */
  cue: Person | null;
  /** The owner chose to play the one about to act. */
  playingCue: boolean;
  draft: Draft;
  onDraft: (draft: Draft) => void;
  busy: boolean;
  /** Whether the owner plays others too (the switch off). */
  playOthers: boolean;
  onPlayOthers: (playOthers: boolean) => void;
  onHints: () => void;
  onPlayCue: () => void;
  onActorPlays: () => void;
  /** Back to asking who plays the one about to act. */
  onCueAgain: () => void;
  onSend: () => void;
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

/** Whether the box takes words now. */
function canWrite(stage: Stage): boolean {
  if (stage === 'openings' || stage === 'playing' || stage === 'cue') {
    return true;
  }
  return false;
}

export function MoveBox(props: Props) {
  const { stage, protagonist, cue, playingCue, draft, onDraft, busy, playOthers } = props;

  if (stage === 'cue' && cue && !playingCue) {
    return <CueAsk cue={cue} busy={busy} onPlay={props.onPlayCue} onActor={props.onActorPlays} />;
  }

  const writing = canWrite(stage);
  let asAuthor = draft.voice === 'author';
  if (stage === 'openings') {
    asAuthor = true;
  }

  let chip;
  if (stage === 'openings') {
    chip = <span className="chip play-voice">as the author</span>;
  } else if (stage === 'cue' && cue) {
    chip = (
      <button type="button" className="chip play-voice" onClick={props.onCueAgain} aria-label={`Playing ${cue.name}. Ask again who plays them.`}>
        as {cue.name}
      </button>
    );
  } else {
    let next: MoveVoice = 'author';
    let text = `as ${protagonist.name}`;
    if (draft.voice === 'author') {
      next = 'character';
      text = 'as the author';
    }
    chip = (
      <button
        type="button"
        className="chip play-voice"
        disabled={!writing}
        aria-label={`Writing ${text}. Switch.`}
        onClick={() => onDraft({ ...draft, voice: next })}
      >
        {text}
      </button>
    );
  }

  let placeholder = '';
  if (stage === 'openings') {
    placeholder = 'Or write how it opens';
  } else if (stage === 'cue' && cue) {
    placeholder = `What ${cue.name} does and says`;
  } else if (writing && asAuthor) {
    placeholder = 'A note for the story, like “skip to the next morning”';
  } else if (writing) {
    placeholder = `What ${protagonist.name} does and says`;
  }

  let className = 'play-box';
  if (asAuthor) {
    className += ' is-author';
  }

  const send = () => {
    if (busy || !writing || !draft.text.trim()) {
      return;
    }
    props.onSend();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (sends(e)) {
      e.preventDefault();
      send();
    }
  };

  let hints = null;
  if (stage === 'playing' || stage === 'cue') {
    hints = (
      <button type="button" className="btn btn-ghost play-hints-btn" disabled={busy} onClick={props.onHints}>
        Hints
      </button>
    );
  }

  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <div className="play-box-top">{chip}</div>
      <textarea
        className="play-box-text"
        value={draft.text}
        rows={2}
        maxLength={LONG_LIMIT}
        disabled={!writing}
        aria-label="Your move"
        placeholder={placeholder}
        onChange={(e) => onDraft({ ...draft, text: e.target.value })}
        onKeyDown={onKeyDown}
      />
      <div className="play-box-row">
        {hints}
        <label className="play-switch">
          <button
            type="button"
            role="switch"
            className="switch"
            aria-checked={!playOthers}
            onClick={() => props.onPlayOthers(!playOthers)}
          />
          <span>Main character and author only</span>
        </label>
        <button type="submit" className="btn btn-primary play-send" disabled={busy || !writing || !draft.text.trim()}>
          Send
        </button>
      </div>
    </form>
  );
}

interface CueProps {
  cue: Person;
  busy: boolean;
  onPlay: () => void;
  onActor: () => void;
}

/** Someone in the cast is about to act: the owner plays them this time, or their actor does. */
function CueAsk({ cue, busy, onPlay, onActor }: CueProps) {
  return (
    <div className="play-box play-cue" role="group" aria-label={`${cue.name} is about to act`}>
      <p className="play-cue-text">{cue.name} is about to act.</p>
      <div className="play-cue-actions">
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={onActor}>
          {cue.name}’s actor plays
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={onPlay}>
          Play {cue.name}
        </button>
      </div>
    </div>
  );
}
