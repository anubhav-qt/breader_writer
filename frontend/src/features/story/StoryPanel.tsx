import { useState } from 'react';
import { motion } from 'motion/react';
import { CAST_LIMIT, TITLE_LIMIT, everyone, type World } from '@writer/shared/book';
import type { BookChoices, Reach, StoryView } from '@writer/shared/story';
import { IconClose, IconPlus } from '../../components/icons';
import { DARKNESS, LENGTHS, POVS } from '../../data/setup';
import { springs } from '../../lib/springs';
import { Choices, Field } from '../setup/Fields';
import { RelationshipGraph } from '../setup/RelationshipGraph';
import { CastCard } from '../setup/SetupPage';
import { ChatSheet } from '../setup/SuggestionsChat';
import { bookSaving, choicesOf } from './reach';
import { ReachChoice, SaveStatus } from './StorySheets';
import type { StoryState } from './useStory';
import '../setup/setup.css';
import '../setup/chat.css';
import './story.css';

/*
 * The Story panel (step 6): the story mid play, a panel away (the owner's picks, 2026-10-07 and
 * 2026-10-11). Beside the play on a laptop, a sheet over it on a phone, as the Suggestions chat
 * is. The book's settings and the world at the top as fields, then the cast as cards and the
 * relationship graph, all setup's own pieces; a card or a line opens its sheet over the page. Once
 * the book or the world has changed, a Save shows at the panel's end, split into "From now on" and
 * "Always so" unless the change saves plainly (a title, a length).
 */

interface Props {
  state: StoryState;
  /** A panel beside the play, or a sheet over it. */
  wide: boolean;
  /** Procreator is writing in the book, so nothing can be saved until it's done. */
  held: boolean;
  onClose: () => void;
}

export function StoryPanel({ state, wide, held, onClose }: Props) {
  const body = <StoryBody state={state} held={held} onClose={onClose} />;
  if (wide) {
    return (
      <motion.aside
        className="chat-panel story-panel"
        aria-label="Story"
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
    <ChatSheet label="Story" onClose={onClose}>
      {body}
    </ChatSheet>
  );
}

function StoryBody({ state, held, onClose }: { state: StoryState; held: boolean; onClose: () => void }) {
  const story = state.story;
  let content = null;
  if (story) {
    content = <StoryFields story={story} state={state} held={held} />;
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
        Reading the story
      </div>
    );
  }
  return (
    <div className="chat story">
      <div className="modal-head chat-head">
        <h2 className="modal-title">Story</h2>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close the story">
          <IconClose />
        </button>
      </div>
      {content}
    </div>
  );
}

function StoryFields({ story, state, held }: { story: StoryView; state: StoryState; held: boolean }) {
  // Null until the owner changes the book or the world: what's shown is the story as it stands.
  const [draft, setDraft] = useState<BookChoices | null>(null);
  const saved = choicesOf(story);
  const shown = draft ?? saved;
  const how = bookSaving(story.played, saved, shown);
  const setup = story.setup;
  const people = everyone(setup);

  const set = (next: BookChoices) => {
    state.clearError();
    setDraft(next);
  };
  const setWorld = (field: keyof World, value: string) => {
    set({ ...shown, world: { ...shown.world, [field]: value } });
  };
  const save = async (reach: Reach) => {
    const kept = await state.edit({ kind: 'book', book: shown }, reach);
    if (kept) {
      setDraft(null);
    }
  };

  const stopped = state.saving !== null || held;
  const titled = shown.title.trim() !== '';
  let end = null;
  if (how !== 'unchanged') {
    let buttons = null;
    if (how === 'asks') {
      buttons = (
        <ReachChoice
          lines={{
            now: 'It changes here, and the story plays it as something that just happened.',
            always: 'It was always so: what was played is rewritten to match.',
          }}
          disabled={stopped || !titled}
          onPick={(reach) => void save(reach)}
        />
      );
    } else {
      buttons = (
        <button type="button" className="btn btn-primary" disabled={stopped || !titled} onClick={() => void save('now')}>
          Save
        </button>
      );
    }
    let missing = null;
    if (!titled) {
      missing = <p className="add-found">The book needs a title.</p>;
    }
    end = (
      <div className="story-end">
        <SaveStatus state={state} held={held} changed />
        <div className="story-end-row">
          <button type="button" className="btn btn-ghost" disabled={state.saving !== null} onClick={() => setDraft(null)}>
            Discard
          </button>
          {how === 'plain' && buttons}
        </div>
        {how === 'asks' && buttons}
        {missing}
      </div>
    );
  }
  // A failure with nothing changed in the panel is shown at its top, unless a sheet has it.
  let error = null;
  if (how === 'unchanged' && state.error && !state.opened) {
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
        <section className="setup-section" aria-labelledby="story-book">
          <h2 id="story-book">The book</h2>
          <Field label="Title" value={shown.title} max={TITLE_LIMIT} className="setup-title" placeholder="What it’s called" onChange={(title) => set({ ...shown, title })} />
          <Choices label="Length" choices={LENGTHS} value={shown.length} onPick={(length) => set({ ...shown, length })} />
          <Choices label="Point of view" choices={POVS} value={shown.pov} onPick={(pov) => set({ ...shown, pov })} />
          <Choices label="How dark it goes" choices={DARKNESS} value={shown.darkness} onPick={(darkness) => set({ ...shown, darkness })} />
        </section>

        <section className="setup-section" aria-labelledby="story-world">
          <h2 id="story-world">The world</h2>
          <div className="setup-pair">
            <Field label="Genre" value={shown.world.genre} placeholder="Fantasy, mystery, romance" onChange={(v) => setWorld('genre', v)} />
            <Field label="Tone" value={shown.world.tone} placeholder="Cosy, grim, funny" onChange={(v) => setWorld('tone', v)} />
          </div>
          <Field label="Setting" size="long" value={shown.world.setting} placeholder="When and where" onChange={(v) => setWorld('setting', v)} />
          <Field label="Rules that matter" size="long" value={shown.world.rules} placeholder="Magic, technology, power" onChange={(v) => setWorld('rules', v)} />
          <Field label="Notes" size="notes" value={shown.world.notes} placeholder="Anything else about the world" onChange={(v) => setWorld('notes', v)} />
        </section>

        <section className="setup-section" aria-labelledby="story-cast">
          <h2 id="story-cast">The cast</h2>
          <div className="cast story-cast">
            <CastCard character={setup.protagonist} plays onOpen={() => state.open({ kind: 'person', id: setup.protagonist.id })} />
            {setup.cast.map((character) => (
              <CastCard key={character.id} character={character} plays={false} onOpen={() => state.open({ kind: 'person', id: character.id })} />
            ))}
            {setup.cast.length < CAST_LIMIT && (
              <button type="button" className="cast-card cast-add" onClick={() => state.open({ kind: 'new' })}>
                <IconPlus /> Add someone
              </button>
            )}
          </div>
        </section>

        <section className="setup-section" aria-labelledby="story-relationships">
          <h2 id="story-relationships">Relationships</h2>
          <RelationshipGraph
            people={people}
            protagonistId={setup.protagonist.id}
            relationships={setup.relationships}
            onOpen={(a, b) => state.open({ kind: 'line', a, b })}
          />
        </section>
      </div>
      {end}
    </>
  );
}
