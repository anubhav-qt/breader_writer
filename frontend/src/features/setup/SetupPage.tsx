import { useState, type ReactNode } from 'react';
import { AnimatePresence } from 'motion/react';
import { CAST_LIMIT, everyone, type BookSetup, type Character, type Length, type Pov, type Relationship, type World } from '@writer/shared/book';
import { IconClose, IconPlus } from '../../components/icons';
import { Logo } from '../../components/Logo';
import {
  blankRelationship,
  findRelationship,
  withCharacter,
  withoutCharacter,
  withoutRelationship,
  withRelationship,
} from '@writer/shared/setup';
import { DARKNESS, DEFAULT_POV, LENGTHS, LIGHT_NOVEL_POV, POVS, blankCharacter } from '../../data/setup';
import { CharacterSheet } from './CharacterSheet';
import { Choices, Field } from './Fields';
import { RelationshipGraph } from './RelationshipGraph';
import { RelationshipSheet } from './RelationshipSheet';
import '../add/add.css';
import './setup.css';

/** The page around setup: the logo, a way back to the library, and what's on it. */
export function SetupShell({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <div className="setup-page">
      <header className="setup-bar">
        <Logo />
        <button type="button" className="modal-close" onClick={onClose} aria-label="Back to the library">
          <IconClose />
        </button>
      </header>
      {children}
    </div>
  );
}

interface FormProps {
  heading: string;
  setup: BookSetup;
  onChange: (setup: BookSetup) => void;
  /** Whether picking a length may still change the point of view: light novels suggest first person. */
  suggestPov: boolean;
  onPovPicked: () => void;
  /** Start or Save, and what's still missing. */
  actions: ReactNode;
}

/**
 * One page, top to bottom (see CLAUDE.md): the book, the world, the cast as cards, the
 * relationships as a graph, and the actions at the end. A card opens the character's sheet over
 * the page, and a line in the graph opens the relationship's.
 */
export function SetupForm({ heading, setup, onChange, suggestPov, onPovPicked, actions }: FormProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [openPair, setOpenPair] = useState<[string, string] | null>(null);

  const pickLength = (length: Length) => {
    let pov = setup.pov;
    if (suggestPov && length === 'light_novel') {
      pov = LIGHT_NOVEL_POV;
    } else if (suggestPov) {
      pov = DEFAULT_POV;
    }
    onChange({ ...setup, length, pov });
  };
  const pickPov = (pov: Pov) => {
    onPovPicked();
    onChange({ ...setup, pov });
  };
  const setWorld = (field: keyof World, value: string) => {
    onChange({ ...setup, world: { ...setup.world, [field]: value } });
  };

  const addCharacter = () => {
    const character = blankCharacter();
    onChange({ ...setup, cast: [...setup.cast, character] });
    setOpenId(character.id);
  };
  const removeCharacter = (id: string) => {
    setOpenId(null);
    onChange(withoutCharacter(setup, id));
  };
  // Someone in the cast left without a name was never really added.
  const closeSheet = () => {
    const leaving = setup.cast.find((character) => character.id === openId);
    setOpenId(null);
    if (leaving && !leaving.name.trim()) {
      onChange(withoutCharacter(setup, leaving.id));
    }
  };

  // Tying two people who aren't tied yet starts a blank line between them.
  const openRelationship = (oneId: string, otherId: string) => {
    if (!findRelationship(setup, oneId, otherId)) {
      onChange(withRelationship(setup, blankRelationship(oneId, otherId)));
    }
    setOpenPair([oneId, otherId]);
  };
  const untie = (oneId: string, otherId: string) => {
    setOpenPair(null);
    onChange(withoutRelationship(setup, oneId, otherId));
  };

  const open = findCharacter(setup, openId);
  let openLine: Relationship | undefined;
  if (openPair) {
    openLine = findRelationship(setup, openPair[0], openPair[1]);
  }
  const people = everyone(setup);
  let povNotes: Partial<Record<Pov, string>> = {};
  if (setup.length === 'light_novel') {
    povNotes = { [LIGHT_NOVEL_POV]: 'Light novels usually are' };
  }

  return (
    <main className="setup">
      <h1 className="setup-heading">{heading}</h1>

      <section className="setup-section" aria-labelledby="setup-book">
        <h2 id="setup-book">The book</h2>
        <Field label="Title" value={setup.title} max={120} className="setup-title" placeholder="What it’s called" onChange={(title) => onChange({ ...setup, title })} />
        <Choices label="Length" choices={LENGTHS} value={setup.length} onPick={pickLength} />
        <Choices label="Point of view" choices={POVS} value={setup.pov} notes={povNotes} onPick={pickPov} />
        <Choices label="How dark it goes" choices={DARKNESS} value={setup.darkness} onPick={(darkness) => onChange({ ...setup, darkness })} />
      </section>

      <section className="setup-section" aria-labelledby="setup-world">
        <h2 id="setup-world">The world</h2>
        <p className="setup-hint">All of it is optional. The story fills in whatever you leave blank.</p>
        <div className="setup-pair">
          <Field label="Genre" value={setup.world.genre} placeholder="Fantasy, mystery, romance" onChange={(v) => setWorld('genre', v)} />
          <Field label="Tone" value={setup.world.tone} placeholder="Cosy, grim, funny" onChange={(v) => setWorld('tone', v)} />
        </div>
        <Field label="Setting" size="long" value={setup.world.setting} placeholder="When and where" onChange={(v) => setWorld('setting', v)} />
        <Field label="Rules that matter" size="long" value={setup.world.rules} placeholder="Magic, technology, power" onChange={(v) => setWorld('rules', v)} />
        <Field label="Notes" size="notes" value={setup.world.notes} placeholder="Anything else about the world" onChange={(v) => setWorld('notes', v)} />
      </section>

      <section className="setup-section" aria-labelledby="setup-cast">
        <h2 id="setup-cast">The cast</h2>
        <p className="setup-hint">You play the first. Only names are needed: the story fills in the rest.</p>
        <div className="cast">
          <CastCard character={setup.protagonist} plays onOpen={() => setOpenId(setup.protagonist.id)} />
          {setup.cast.map((character) => (
            <CastCard key={character.id} character={character} plays={false} onOpen={() => setOpenId(character.id)} />
          ))}
          {setup.cast.length < CAST_LIMIT && (
            <button type="button" className="cast-card cast-add" onClick={addCharacter}>
              <IconPlus /> Add someone
            </button>
          )}
        </div>
      </section>

      <section className="setup-section" aria-labelledby="setup-relationships">
        <h2 id="setup-relationships">Relationships</h2>
        <RelationshipGraph people={people} protagonistId={setup.protagonist.id} relationships={setup.relationships} onOpen={openRelationship} />
      </section>

      <div className="setup-end">{actions}</div>

      <AnimatePresence>
        {open && (
          <CharacterSheet
            key={open.id}
            character={open}
            plays={open.id === setup.protagonist.id}
            onChange={(character) => onChange(withCharacter(setup, character))}
            onRemove={() => removeCharacter(open.id)}
            onClose={closeSheet}
          />
        )}
        {openLine && (
          <RelationshipSheet
            key={`${openLine.a.id} ${openLine.b.id}`}
            relationship={openLine}
            people={people}
            protagonistId={setup.protagonist.id}
            onChange={(relationship) => onChange(withRelationship(setup, relationship))}
            onUntie={() => untie(openLine.a.id, openLine.b.id)}
            onClose={() => setOpenPair(null)}
          />
        )}
      </AnimatePresence>
    </main>
  );
}

function findCharacter(setup: BookSetup, id: string | null): Character | undefined {
  if (!id) {
    return undefined;
  }
  return everyone(setup).find((character) => character.id === id);
}

function CastCard({ character, plays, onOpen }: { character: Character; plays: boolean; onOpen: () => void }) {
  const name = character.name.trim();
  let nameText = name;
  if (!name && plays) {
    nameText = 'Who do you play?';
  } else if (!name) {
    nameText = 'No name yet';
  }
  let nameClass = 'cast-name';
  if (!name) {
    nameClass += ' is-blank';
  }
  return (
    <button type="button" className="cast-card" onClick={onOpen}>
      {plays && <span className="chip cast-you">You play</span>}
      <span className={nameClass}>{nameText}</span>
      {character.who.trim() && <span className="cast-who">{character.who}</span>}
    </button>
  );
}
