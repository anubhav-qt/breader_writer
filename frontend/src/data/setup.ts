import { z } from 'zod';
import {
  BookSetup,
  Character,
  Darkness,
  Length,
  Pov,
  SCENE_WORDS,
  WORD_GOALS,
  World,
  everyone,
} from '@writer/shared/book';
import { BookCard } from '@writer/shared/protocol';
import { writer } from '../lib/api';
import { readLocal, writeLocal } from '../lib/store';
import { LENGTH_NAMES } from './books';

/*
 * A book's setup while it's being made or changed on the setup page: its settings, world and
 * cast. Names can be blank here, until the book is started or saved.
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
  return { id: crypto.randomUUID(), name: '', who: '', personality: '', past: '', feelings: {}, notes: '' };
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
  };
}

/** The setup without this character, and without anyone's feelings about them. */
export function withoutCharacter(setup: BookSetup, id: string): BookSetup {
  const forget = (character: Character): Character => {
    const feelings = { ...character.feelings };
    delete feelings[id];
    return { ...character, feelings };
  };
  const cast = setup.cast.filter((character) => character.id !== id);
  return { ...setup, protagonist: forget(setup.protagonist), cast: cast.map(forget) };
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
  }),
  /** Whether the owner picked the point of view themselves, so a length doesn't change it. */
  povChosen: z.boolean(),
});
export type Draft = z.infer<typeof Draft>;

export function readDraft(): Draft | null {
  const parsed = Draft.safeParse(readLocal<unknown>(DRAFT_KEY, null));
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
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
  return !setup.title && !world && !people && setup.cast.length === 0;
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
