import { z } from 'zod';

/*
 * What a book is set up with: its settings, its world, its cast and the relationships between
 * them. The server stores it, the setup page edits it, and later every prompt is built from it.
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
/** A character's id. Lowercase, so two ids compare in JavaScript the way Postgres orders them. */
const Id = z.uuid().toLowerCase();

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
 * it's being set up, and relationships can be tied to it before the book is saved.
 */
export const Character = z.object({
  id: Id,
  name: z.string().trim().min(1, 'Every character needs a name.').max(80),
  /** Who they are. */
  who: Long,
  personality: Long,
  past: Long,
  notes: Notes,
});
export type Character = z.infer<typeof Character>;

/** The most characters a cast can have, besides the protagonist. */
export const CAST_LIMIT = 40;

/** One person's side of a relationship: how they see the other, and what they hide from them. */
export const Side = z.object({
  /** Whose side it is. */
  id: Id,
  sees: Long,
  hides: Long,
});
export type Side = z.infer<typeof Side>;

/**
 * A line in the relationship graph: what two people are to each other (the bond, which they
 * share, like "sisters, rivals for the throne"), and each one's side. Only the tie is needed:
 * the story fills in whatever is blank.
 */
export const Relationship = z.object({
  bond: Short,
  a: Side,
  b: Side,
});
export type Relationship = z.infer<typeof Relationship>;

/** The most relationships a book can have. */
export const RELATIONSHIP_LIMIT = 300;

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
  /** The lines between them. */
  relationships: z.array(Relationship).max(RELATIONSHIP_LIMIT),
});

/** Every character in a setup, the protagonist first. */
export function everyone(setup: { protagonist: Character; cast: Character[] }): Character[] {
  return [setup.protagonist, ...setup.cast];
}

/** The same key for a pair of people whichever way round they're given. */
export function pairKey(oneId: string, otherId: string): string {
  if (oneId < otherId) {
    return `${oneId} ${otherId}`;
  }
  return `${otherId} ${oneId}`;
}

/** The relationship with its sides in the order they're stored: the smaller id first. */
export function inOrder(relationship: Relationship): Relationship {
  if (relationship.a.id < relationship.b.id) {
    return relationship;
  }
  return { ...relationship, a: relationship.b, b: relationship.a };
}

/**
 * What a book is set up with: POST /v1/books, and GET and PUT /v1/books/:id/setup. No two
 * characters share an id, and a relationship is between two different people in the cast, with
 * one line at most between any two.
 */
export const BookSetup = SetupFields.superRefine((setup, ctx) => {
  const names = new Map<string, string>();
  for (const character of everyone(setup)) {
    if (names.has(character.id)) {
      ctx.addIssue({ code: 'custom', message: `Two characters have the id ${character.id}.` });
    }
    names.set(character.id, character.name);
  }

  const pairs = new Set<string>();
  for (const relationship of setup.relationships) {
    const one = names.get(relationship.a.id);
    const other = names.get(relationship.b.id);
    const key = pairKey(relationship.a.id, relationship.b.id);
    if (one === undefined || other === undefined) {
      ctx.addIssue({ code: 'custom', message: 'A relationship is with someone not in the cast.' });
    } else if (relationship.a.id === relationship.b.id) {
      ctx.addIssue({ code: 'custom', message: `${one} has a relationship with themselves.` });
    } else if (pairs.has(key)) {
      ctx.addIssue({ code: 'custom', message: `${one} and ${other} have two relationships.` });
    }
    pairs.add(key);
  }
});
export type BookSetup = z.infer<typeof BookSetup>;
