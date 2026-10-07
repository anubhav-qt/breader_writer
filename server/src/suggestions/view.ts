import { WORD_GOALS, everyone, type Character, type Relationship, type World } from '@writer/shared/book';
import { sidesInCastOrder } from '@writer/shared/setup';
import { fieldLimit, fieldText, type DraftSetup, type FieldRef } from '@writer/shared/suggestions';
import { settingsView, type SettingsView } from '../story/view.ts';

/*
 * The setup page as Procreator's setup prompts take it (src/prompts/templates/suggestions/): every
 * field, the blank ones too, so it sees what's left to fill. People go by a ref: their name,
 * "Unnamed 1" while they have none, and "Mara (2)" for a second Mara, so each can be named
 * without doubt. All the logic is here; the templates only lay it out.
 */

/** Each person's ref, by their id. */
export type Refs = Map<string, string>;

/** Everyone's ref, in cast order. */
export function refsOf(setup: DraftSetup): Refs {
  const refs: Refs = new Map();
  const seen = new Map<string, number>();
  let unnamed = 0;
  for (const person of everyone(setup)) {
    const name = person.name.trim();
    if (!name) {
      unnamed += 1;
      refs.set(person.id, `Unnamed ${unnamed}`);
      continue;
    }
    const key = name.toLowerCase();
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count === 1) {
      refs.set(person.id, name);
    } else {
      refs.set(person.id, `${name} (${count})`);
    }
  }
  return refs;
}

function refOf(refs: Refs, id: string): string {
  return refs.get(id) ?? 'someone';
}

export interface BookSettingsView extends SettingsView {
  title: string;
}

export interface PersonView {
  ref: string;
  /** The one the owner plays. */
  protagonist: boolean;
  name: string;
  who: string;
  personality: string;
  past: string;
  notes: string;
}

/** One side of a line: how `ref` sees `other`, and what they hide from them. */
export interface SideView {
  ref: string;
  other: string;
  sees: string;
  hides: string;
}

export interface LineView {
  a: string;
  b: string;
  bond: string;
  /** In cast order, the one the owner plays first. */
  sides: SideView[];
}

export interface SetupView {
  book: BookSettingsView;
  world: World;
  people: PersonView[];
  lines: LineView[];
}

function personView(person: Character, refs: Refs, protagonistId: string): PersonView {
  return {
    ref: refOf(refs, person.id),
    protagonist: person.id === protagonistId,
    name: person.name,
    who: person.who,
    personality: person.personality,
    past: person.past,
    notes: person.notes,
  };
}

/** The other one on a line. */
function otherOf(line: Relationship, id: string): string {
  if (line.a.id === id) {
    return line.b.id;
  }
  return line.a.id;
}

function lineView(line: Relationship, people: Character[], refs: Refs): LineView {
  const sides = sidesInCastOrder(line, people).map((side) => ({
    ref: refOf(refs, side.id),
    other: refOf(refs, otherOf(line, side.id)),
    sees: side.sees,
    hides: side.hides,
  }));
  return { a: sides[0].ref, b: sides[1].ref, bond: line.bond, sides };
}

/** The whole page, as Procreator reads it. */
export function setupView(setup: DraftSetup, refs: Refs): SetupView {
  const people = everyone(setup);
  const settings = settingsView(setup.length, WORD_GOALS[setup.length], setup.pov, setup.darkness);
  const lines = setup.relationships.map((line) => lineView(line, people, refs));
  return {
    book: { title: setup.title, ...settings },
    world: setup.world,
    people: people.map((person) => personView(person, refs, setup.protagonist.id)),
    lines,
  };
}

/** How much a field holds, as the page sizes it: a line, a paragraph, or a notes box. */
export type FieldSize = 'line' | 'long' | 'notes';

/** The field clicked into: where it is, what it's for, how much it holds, and what's in it. */
export interface FieldView {
  where: string;
  holds: string;
  size: FieldSize;
  /** The most characters it holds. */
  max: number;
  text: string;
}

interface About {
  where: string;
  holds: string;
  size: FieldSize;
}

const WORLD_FIELDS: Record<string, About> = {
  genre: { where: 'The world: genre', holds: 'The genre, in a few words (fantasy, mystery, romance).', size: 'line' },
  tone: { where: 'The world: tone', holds: 'The tone, in a few words (cosy, grim, funny).', size: 'line' },
  setting: { where: 'The world: setting', holds: 'When and where the story happens.', size: 'long' },
  rules: { where: 'The world: rules that matter', holds: 'The rules that matter: magic, technology, power.', size: 'long' },
  notes: { where: 'The world: notes', holds: 'Anything else about the world.', size: 'notes' },
};

/** What each field of a sheet is for, after "<ref>'s sheet: ". */
const SHEET_FIELDS: Record<string, { label: string; holds: string; size: FieldSize }> = {
  name: { label: 'name', holds: 'Their name, fitting the world.', size: 'line' },
  who: { label: 'who they are', holds: 'Their place in the world: work, age, family.', size: 'long' },
  personality: { label: 'personality', holds: 'How they act, what they want, what they fear.', size: 'long' },
  past: { label: 'past', holds: 'What happened to them before the story starts.', size: 'long' },
  notes: { label: 'notes', holds: 'Anything else about them: looks, habits, how they talk.', size: 'notes' },
};

function aboutField(setup: DraftSetup, field: FieldRef, refs: Refs): About {
  if (field.kind === 'title') {
    return { where: 'The book: title', holds: 'What the book is called.', size: 'line' };
  }
  if (field.kind === 'world') {
    return WORLD_FIELDS[field.field];
  }
  if (field.kind === 'character') {
    const sheet = SHEET_FIELDS[field.field];
    const person = refOf(refs, field.id);
    let whose = `${person}'s sheet`;
    if (field.id === setup.protagonist.id) {
      whose = `${person}'s sheet (the one the owner plays)`;
    }
    return { where: `${whose}: ${sheet.label}`, holds: sheet.holds, size: sheet.size };
  }
  if (field.kind === 'bond') {
    const a = refOf(refs, field.a);
    const b = refOf(refs, field.b);
    return {
      where: `The line between ${a} and ${b}: what they are to each other`,
      holds: 'What the two are to each other, often several things at once (sisters, rivals for the throne).',
      size: 'line',
    };
  }
  const person = refOf(refs, field.id);
  const other = refOf(refs, field.other);
  if (field.field === 'sees') {
    return { where: `How ${person} sees ${other}`, holds: `What ${person} thinks and feels about ${other}.`, size: 'long' };
  }
  return { where: `What ${person} hides from ${other}`, holds: `Secrets, debts, what ${person} would never say to ${other}.`, size: 'long' };
}

/** A field of the page, or null when it isn't on it. */
export function fieldView(setup: DraftSetup, field: FieldRef, refs: Refs): FieldView | null {
  const text = fieldText(setup, field);
  if (text === null) {
    return null;
  }
  return { ...aboutField(setup, field, refs), max: fieldLimit(field), text };
}

/** How much to suggest for a field: by its size, and whether anything is written in it yet. */
export function lengthFor(field: FieldView): string {
  if (field.size === 'line') {
    return 'a few words, on one line';
  }
  if (field.size === 'long' && field.text === '') {
    return 'one to three sentences';
  }
  if (field.size === 'long') {
    return 'a sentence or two, going on from where it stops';
  }
  if (field.text === '') {
    return 'a few short lines';
  }
  return 'a line or two more';
}
