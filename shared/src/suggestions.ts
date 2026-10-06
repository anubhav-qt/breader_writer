import { z } from 'zod';
import {
  CAST_LIMIT,
  Character,
  Darkness,
  Id,
  LONG_LIMIT,
  Length,
  NAME_LIMIT,
  NOTES_LIMIT,
  Pov,
  RELATIONSHIP_LIMIT,
  Relationship,
  SHORT_LIMIT,
  TITLE_LIMIT,
  World,
  checkPeople,
  everyone,
  type BookSetup,
} from './book.ts';
import { findRelationship } from './setup.ts';

/*
 * Procreator's help with setup (step 5): its suggestion for the field the owner clicks into, shown
 * as faint text after what's written there.
 */

/** A character's sheet while it's being filled in: the name may still be blank. */
const DraftCharacter = Character.extend({ name: z.string().trim().max(NAME_LIMIT) });

/** A setup as the page holds it while it's being filled in: the title and names may still be blank. */
export const DraftSetup = z
  .object({
    title: z.string().trim().max(TITLE_LIMIT),
    color: z.string().max(32),
    length: Length,
    pov: Pov,
    darkness: Darkness,
    world: World,
    protagonist: DraftCharacter,
    cast: z.array(DraftCharacter).max(CAST_LIMIT),
    relationships: z.array(Relationship).max(RELATIONSHIP_LIMIT),
  })
  .superRefine(checkPeople);
export type DraftSetup = z.infer<typeof DraftSetup>;

export const WorldField = z.enum(['genre', 'tone', 'setting', 'rules', 'notes']);
export type WorldField = z.infer<typeof WorldField>;

export const SheetField = z.enum(['name', 'who', 'personality', 'past', 'notes']);
export type SheetField = z.infer<typeof SheetField>;

export const SideField = z.enum(['sees', 'hides']);
export type SideField = z.infer<typeof SideField>;

/**
 * A text field on the setup page: the title, a field of the world, a field of someone's sheet, a
 * line's bond, or one side of a line (how `id` sees `other`, or what they hide from them).
 */
export const FieldRef = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('title') }),
  z.object({ kind: z.literal('world'), field: WorldField }),
  z.object({ kind: z.literal('character'), id: Id, field: SheetField }),
  z.object({ kind: z.literal('bond'), a: Id, b: Id }),
  z.object({ kind: z.literal('side'), id: Id, other: Id, field: SideField }),
]);
export type FieldRef = z.infer<typeof FieldRef>;

const WORLD_LIMITS: Record<WorldField, number> = {
  genre: SHORT_LIMIT,
  tone: SHORT_LIMIT,
  setting: LONG_LIMIT,
  rules: LONG_LIMIT,
  notes: NOTES_LIMIT,
};

const SHEET_LIMITS: Record<SheetField, number> = {
  name: NAME_LIMIT,
  who: LONG_LIMIT,
  personality: LONG_LIMIT,
  past: LONG_LIMIT,
  notes: NOTES_LIMIT,
};

/** The most characters a field holds, as BookSetup allows. */
export function fieldLimit(field: FieldRef): number {
  if (field.kind === 'title') {
    return TITLE_LIMIT;
  }
  if (field.kind === 'world') {
    return WORLD_LIMITS[field.field];
  }
  if (field.kind === 'character') {
    return SHEET_LIMITS[field.field];
  }
  if (field.kind === 'bond') {
    return SHORT_LIMIT;
  }
  return LONG_LIMIT;
}

/** POST /v1/suggestions/field: the page as it stands, the field clicked into, and the book, if it's made. */
export const FieldAsk = z.object({
  setup: DraftSetup,
  field: FieldRef,
  bookId: z.uuid().nullable(),
});
export type FieldAsk = z.infer<typeof FieldAsk>;

/**
 * What POST /v1/suggestions/field answers: what could come after the field's text, starting with
 * a space where it needs one, or empty when there's nothing worth adding.
 */
export const FieldSuggestion = z.object({
  text: z.string(),
});
export type FieldSuggestion = z.infer<typeof FieldSuggestion>;

/** How many things must be filled in before Procreator suggests anything: it needs something to go on. */
export const SUGGEST_AFTER = 3;

/** How many things on the page are filled in: the title and every field of the world, the sheets and the lines. */
export function filledIn(setup: BookSetup): number {
  const texts: string[] = [setup.title, ...Object.values(setup.world)];
  for (const person of everyone(setup)) {
    texts.push(person.name, person.who, person.personality, person.past, person.notes);
  }
  for (const line of setup.relationships) {
    texts.push(line.bond, line.a.sees, line.a.hides, line.b.sees, line.b.hides);
  }
  const filled = texts.filter((text) => text.trim() !== '');
  return filled.length;
}

/** Someone on the page, by id. */
export function characterById(setup: BookSetup, id: string): Character | undefined {
  return everyone(setup).find((person) => person.id === id);
}

/** The text in a field, or null when the field isn't on the page: its person or its line is gone. */
export function fieldText(setup: BookSetup, field: FieldRef): string | null {
  if (field.kind === 'title') {
    return setup.title;
  }
  if (field.kind === 'world') {
    return setup.world[field.field];
  }
  if (field.kind === 'character') {
    const person = characterById(setup, field.id);
    if (!person) {
      return null;
    }
    return person[field.field];
  }
  if (field.kind === 'bond') {
    const line = findRelationship(setup, field.a, field.b);
    if (!line) {
      return null;
    }
    return line.bond;
  }
  const line = findRelationship(setup, field.id, field.other);
  if (!line) {
    return null;
  }
  if (line.a.id === field.id) {
    return line.a[field.field];
  }
  return line.b[field.field];
}
