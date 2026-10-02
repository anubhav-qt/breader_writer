import { z } from 'zod';

/*
 * What a book is set up with: its settings, its world and its cast. The server stores it, the
 * setup page edits it, and later every prompt is built from it.
 */

/** About how many words a scene is written up as. The length goals are counted in scenes of it. */
export const SCENE_WORDS = 2000;

/** How long the book is. Light novel is a style as well as a length (see CLAUDE.md). */
export const Length = z.enum(['short_story', 'novella', 'light_novel', 'novel']);
export type Length = z.infer<typeof Length>;

/** Each length's goal in words. The card's bar is words written over it. */
export const WORD_GOALS: Record<Length, number> = {
  short_story: 8000,
  novella: 30000,
  light_novel: 50000,
  novel: 80000,
};

/** Whose eyes the book is written through. Third person close is the default. */
export const Pov = z.enum(['third_close', 'first', 'third_omniscient']);
export type Pov = z.infer<typeof Pov>;

/** How dark the story goes. Mature is the default. */
export const Darkness = z.enum(['gentle', 'mature', 'unflinching']);
export type Darkness = z.infer<typeof Darkness>;

/** A short field on a sheet, like a genre. Blank is fine: the AI fills blanks. */
const Short = z.string().trim().max(200);
/** A longer field, like a character's past. */
const Long = z.string().trim().max(4000);
/** A free notes box. */
const Notes = z.string().trim().max(20000);

/** The world, a few fields plus notes. All optional. */
export const World = z.object({
  genre: Short,
  tone: Short,
  /** When and where. */
  setting: Long,
  /** The rules that matter: magic, technology, power. */
  rules: Long,
  notes: Notes,
});
export type World = z.infer<typeof World>;

/**
 * A character's sheet. Only the name is required. The app makes the id, so a sheet keeps it while
 * it's being set up, and other sheets can say how they feel about it.
 */
export const Character = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1, 'Every character needs a name.').max(80),
  /** Who they are. */
  who: Long,
  personality: Long,
  past: Long,
  /** How they feel about each of the others, by the other's id. */
  feelings: z.record(z.uuid(), Long),
  notes: Notes,
});
export type Character = z.infer<typeof Character>;

/** The most characters a cast can have, besides the protagonist. */
export const CAST_LIMIT = 40;

const SetupFields = z.object({
  title: z.string().trim().min(1, 'The book needs a title.').max(120),
  /** A palette key from the app's book colours (frontend/src/data/colors.ts). */
  color: z.string().min(1).max(32),
  length: Length,
  pov: Pov,
  darkness: Darkness,
  world: World,
  /** The one the owner plays. */
  protagonist: Character,
  /** Everyone else. */
  cast: z.array(Character).max(CAST_LIMIT),
});

/** Every character in a setup, the protagonist first. */
export function everyone(setup: { protagonist: Character; cast: Character[] }): Character[] {
  return [setup.protagonist, ...setup.cast];
}

/**
 * What a book is set up with: POST /v1/books, and GET and PUT /v1/books/:id/setup. No two
 * characters share an id, and feelings are only about someone else in the cast.
 */
export const BookSetup = SetupFields.superRefine((setup, ctx) => {
  const characters = everyone(setup);
  const ids = new Set<string>();
  for (const character of characters) {
    if (ids.has(character.id)) {
      ctx.addIssue({ code: 'custom', message: `Two characters have the id ${character.id}.` });
    }
    ids.add(character.id);
  }
  for (const character of characters) {
    for (const about of Object.keys(character.feelings)) {
      if (about === character.id) {
        ctx.addIssue({ code: 'custom', message: `${character.name} has a feeling about themselves.` });
      } else if (!ids.has(about)) {
        ctx.addIssue({ code: 'custom', message: `${character.name} has a feeling about someone not in the cast.` });
      }
    }
  }
});
export type BookSetup = z.infer<typeof BookSetup>;
