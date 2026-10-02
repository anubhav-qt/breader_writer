import { z } from 'zod';
import {
  BookSetup,
  Character,
  Darkness,
  Length,
  Pov,
  Relationship,
  SCENE_WORDS,
  WORD_GOALS,
  World,
  everyone,
  inOrder,
  pairKey,
  type Side,
} from '@writer/shared/book';
import { BookCard } from '@writer/shared/protocol';
import { writer } from '../lib/api';
import { readLocal, writeLocal } from '../lib/store';
import { LENGTH_NAMES } from './books';

/*
 * A book's setup while it's being made or changed on the setup page: its settings, world, cast
 * and the relationships between them. Names can be blank here, until the book is started or saved.
 */

export interface Choice<T extends string> {
  id: T;
  name: string;
  about: string;
}

function lengthAbout(length: Length): string {
  const words = WORD_GOALS[length];
  const scenes = words / SCENE_WORDS;
  const size = `${words.toLocaleString('en-GB')} words, about ${scenes} scenes.`;
  if (length === 'light_novel') {
    return `${size} Written the way light novels read.`;
  }
  return size;
}

export const LENGTHS: Choice<Length>[] = Length.options.map((id) => ({ id, name: LENGTH_NAMES[id], about: lengthAbout(id) }));

export const POVS: Choice<Pov>[] = [
  { id: 'third_close', name: 'Third person close', about: 'Close behind the one you play: their thoughts, nobody else’s.' },
  { id: 'first', name: 'First person', about: 'Told as “I”, by the one you play.' },
  { id: 'third_omniscient', name: 'Third person omniscient', about: 'A narrator who can see into everyone.' },
];

export const DARKNESS: Choice<Darkness>[] = [
  { id: 'gentle', name: 'Gentle', about: 'For all ages.' },
  { id: 'mature', name: 'Mature', about: 'Violence, grief, cruelty and romance, like a mainstream adult novel.' },
  { id: 'unflinching', name: 'Unflinching', about: 'Whatever the model will write.' },
];

/** Light novels lean first person, so setup suggests it (see CLAUDE.md). */
export const LIGHT_NOVEL_POV: Pov = 'first';
export const DEFAULT_POV: Pov = 'third_close';

export function blankCharacter(): Character {
  return { id: crypto.randomUUID(), name: '', who: '', personality: '', past: '', notes: '' };
}

export function blankSetup(color: string): BookSetup {
  return {
    title: '',
    color,
    length: 'novella',
    pov: DEFAULT_POV,
    darkness: 'mature',
    world: { genre: '', tone: '', setting: '', rules: '', notes: '' },
    protagonist: blankCharacter(),
    cast: [],
    relationships: [],
  };
}

/** The setup without this character, and without their relationships. */
export function withoutCharacter(setup: BookSetup, id: string): BookSetup {
  const cast = setup.cast.filter((character) => character.id !== id);
  const relationships = setup.relationships.filter((relationship) => !involves(relationship, id));
  return { ...setup, cast, relationships };
}

function involves(relationship: Relationship, id: string): boolean {
  return relationship.a.id === id || relationship.b.id === id;
}

/** The setup with this character's sheet changed, whether they're the protagonist or in the cast. */
export function withCharacter(setup: BookSetup, changed: Character): BookSetup {
  if (changed.id === setup.protagonist.id) {
    return { ...setup, protagonist: changed };
  }
  const cast = setup.cast.map((character) => {
    if (character.id === changed.id) {
      return changed;
    }
    return character;
  });
  return { ...setup, cast };
}

/* The relationship graph: a line between two people is a bond and each one's side. */

function blankSide(id: string): Side {
  return { id, sees: '', hides: '' };
}

/** A new line between two people, with nothing written on it yet. */
export function blankRelationship(oneId: string, otherId: string): Relationship {
  return inOrder({ bond: '', a: blankSide(oneId), b: blankSide(otherId) });
}

function samePair(relationship: Relationship, key: string): boolean {
  return pairKey(relationship.a.id, relationship.b.id) === key;
}

/** The relationship between these two, if they have one. */
export function findRelationship(setup: BookSetup, oneId: string, otherId: string): Relationship | undefined {
  const key = pairKey(oneId, otherId);
  return setup.relationships.find((relationship) => samePair(relationship, key));
}

/** The setup with this relationship changed, or added if the two had none. */
export function withRelationship(setup: BookSetup, changed: Relationship): BookSetup {
  const key = pairKey(changed.a.id, changed.b.id);
  const known = setup.relationships.some((relationship) => samePair(relationship, key));
  if (!known) {
    return { ...setup, relationships: [...setup.relationships, changed] };
  }
  const relationships = setup.relationships.map((relationship) => {
    if (samePair(relationship, key)) {
      return changed;
    }
    return relationship;
  });
  return { ...setup, relationships };
}

/** A relationship's two sides in cast order, so the one the owner plays always comes first. */
export function sidesInCastOrder(relationship: Relationship, people: Character[]): [Side, Side] {
  const ids = people.map((person) => person.id);
  if (ids.indexOf(relationship.b.id) < ids.indexOf(relationship.a.id)) {
    return [relationship.b, relationship.a];
  }
  return [relationship.a, relationship.b];
}

/** The setup without the line between these two. */
export function withoutRelationship(setup: BookSetup, oneId: string, otherId: string): BookSetup {
  const key = pairKey(oneId, otherId);
  const relationships = setup.relationships.filter((relationship) => !samePair(relationship, key));
  return { ...setup, relationships };
}

/** What still has to be filled in before the book can be started or saved, or null if nothing. */
export function missing(setup: BookSetup): string | null {
  if (!setup.title.trim()) {
    return 'Give the book a title.';
  }
  if (!setup.protagonist.name.trim()) {
    return 'Give the one you play a name.';
  }
  const unnamed = setup.cast.some((character) => !character.name.trim());
  if (unnamed) {
    return 'Someone in the cast has no name.';
  }
  return null;
}

/* A new book's setup is kept in this browser as it's typed, so closing the page loses nothing. */

const DRAFT_KEY = 'writer.draft.v1';

const DraftCharacter = Character.extend({ name: z.string().max(80) });

const Draft = z.object({
  setup: z.object({
    title: z.string().max(120),
    color: z.string(),
    length: Length,
    pov: Pov,
    darkness: Darkness,
    world: World,
    protagonist: DraftCharacter,
    cast: z.array(DraftCharacter),
    relationships: z.array(Relationship),
  }),
  /** Whether the owner picked the point of view themselves, so a length doesn't change it. */
  povChosen: z.boolean(),
});
export type Draft = z.infer<typeof Draft>;

/*
 * Drafts from before the relationship graph gave each character a line of feelings about each of
 * the others. Reading one turns those lines into the relationships' sides, so nothing typed is lost.
 */

const Feelings = z.record(z.string(), z.string());
const OldCharacter = z.looseObject({ id: z.string(), feelings: Feelings });
const OldDraft = z.looseObject({
  setup: z.looseObject({ protagonist: OldCharacter, cast: z.array(OldCharacter) }),
});
type OldCharacter = z.infer<typeof OldCharacter>;

function sideOf(relationship: Relationship, id: string): Side {
  if (relationship.a.id === id) {
    return relationship.a;
  }
  return relationship.b;
}

function relationshipsFromFeelings(characters: OldCharacter[]): Relationship[] {
  const ids = new Set(characters.map((character) => character.id));
  const byPair = new Map<string, Relationship>();
  for (const character of characters) {
    for (const [aboutId, text] of Object.entries(character.feelings)) {
      const someoneElse = ids.has(aboutId) && aboutId !== character.id;
      if (!text.trim() || !someoneElse) {
        continue;
      }
      const key = pairKey(character.id, aboutId);
      let relationship = byPair.get(key);
      if (!relationship) {
        relationship = blankRelationship(character.id, aboutId);
        byPair.set(key, relationship);
      }
      sideOf(relationship, character.id).sees = text;
    }
  }
  return [...byPair.values()];
}

function fromOldDraft(stored: unknown): Draft | null {
  const old = OldDraft.safeParse(stored);
  if (!old.success) {
    return null;
  }
  const { protagonist, cast } = old.data.setup;
  const relationships = relationshipsFromFeelings([protagonist, ...cast]);
  const parsed = Draft.safeParse({ ...old.data, setup: { ...old.data.setup, relationships } });
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}

export function readDraft(): Draft | null {
  const stored = readLocal<unknown>(DRAFT_KEY, null);
  const parsed = Draft.safeParse(stored);
  if (parsed.success) {
    return parsed.data;
  }
  return fromOldDraft(stored);
}

export function writeDraft(draft: Draft) {
  writeLocal(DRAFT_KEY, draft);
}

export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Storage blocked: there's no draft to clear.
  }
}

/** Whether nothing has been typed yet. */
export function isBlank(setup: BookSetup): boolean {
  const world = Object.values(setup.world).some((value) => value !== '');
  const people = everyone(setup).some((character) => character.name !== '');
  return !setup.title && !world && !people && setup.cast.length === 0 && setup.relationships.length === 0;
}

/* The server. */

export async function makeBook(setup: BookSetup): Promise<BookCard> {
  const data = await writer.post<unknown>('/v1/books', setup);
  return BookCard.parse(data);
}

export async function fetchSetup(bookId: string): Promise<BookSetup> {
  const data = await writer.get<unknown>(`/v1/books/${bookId}/setup`);
  return BookSetup.parse(data);
}

export async function saveSetup(bookId: string, setup: BookSetup): Promise<BookCard> {
  const data = await writer.put<unknown>(`/v1/books/${bookId}/setup`, setup);
  return BookCard.parse(data);
}
