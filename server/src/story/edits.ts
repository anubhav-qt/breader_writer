import { inOrder, WORD_GOALS, type Character, type Darkness, type Length, type Pov, type Relationship } from '@writer/shared/book';
import type { StoryEdit } from '@writer/shared/story';
import { namesOf } from './cast.ts';
import type { Story } from './read.ts';
import { settingsView } from './view.ts';

/*
 * What an owner's change mid story did, as Procreator is told it when it holds from now on
 * (prompts/templates/procreator/change.njk): each thing that changed, and each of its fields as
 * it was and as it is now. Built from the story as it stood before the change, and the change.
 */

/** A field of something the owner changed: what it said, and what it says now. */
export interface FieldChange {
  name: string;
  was: string;
  now: string;
}

/** Something the owner changed ("Ines’s sheet"), and how. */
export interface ChangedView {
  subject: string;
  fields: FieldChange[];
}

export interface ChangeNoteView {
  changed: ChangedView[];
}

/** The fields that differ, each as it was and as it is now. */
function differing(fields: { name: string; was: string; now: string }[]): FieldChange[] {
  const changed: FieldChange[] = [];
  for (const field of fields) {
    if (field.was.trim() !== field.now.trim()) {
      changed.push({ name: field.name, was: field.was.trim(), now: field.now.trim() });
    }
  }
  return changed;
}

function nameOf(story: Story, id: string): string {
  const names = namesOf(story.characters);
  return names.get(id) ?? 'someone';
}

function possessive(name: string): string {
  return `${name}’s`;
}

function sheetFields(was: Omit<Character, 'id'>, now: Omit<Character, 'id'>): FieldChange[] {
  return differing([
    { name: 'Name', was: was.name, now: now.name },
    { name: 'Who they are', was: was.who, now: now.who },
    { name: 'Personality', was: was.personality, now: now.personality },
    { name: 'Past', was: was.past, now: now.past },
    { name: 'Notes', was: was.notes, now: now.notes },
  ]);
}

const BLANK_SHEET = { name: '', who: '', personality: '', past: '', notes: '' };

function sheetChange(story: Story, character: Character): ChangedView[] {
  const before = story.characters.find((each) => each.id === character.id);
  if (!before) {
    return [];
  }
  const fields = sheetFields(before, character);
  if (fields.length === 0) {
    return [];
  }
  return [{ subject: `${possessive(before.name)} sheet`, fields }];
}

function joinChange(character: Character): ChangedView[] {
  const fields = sheetFields(BLANK_SHEET, character).filter((field) => field.name !== 'Name');
  return [{ subject: `${character.name.trim()} joins the cast`, fields }];
}

/** Two people in cast order, the one the owner plays first, as setup's sheet shows a line's sides. */
function inCastOrder(story: Story, one: string, other: string): [string, string] {
  const ids = story.characters.map((person) => person.id);
  if (ids.indexOf(other) < ids.indexOf(one)) {
    return [other, one];
  }
  return [one, other];
}

interface Side {
  sees: string;
  hides: string;
}

function lineChange(story: Story, relationship: Relationship): ChangedView[] {
  const stored = inOrder(relationship);
  const before = story.relationships.find((line) => line.aId === stored.a.id && line.bId === stored.b.id);
  const was = new Map<string, Side>();
  let wasBond = '';
  if (before) {
    was.set(before.aId, { sees: before.aSees, hides: before.aHides });
    was.set(before.bId, { sees: before.bSees, hides: before.bHides });
    wasBond = before.bond;
  }
  const now = new Map<string, Side>([
    [stored.a.id, stored.a],
    [stored.b.id, stored.b],
  ]);
  const blank: Side = { sees: '', hides: '' };
  const [first, second] = inCastOrder(story, stored.a.id, stored.b.id);
  const a = nameOf(story, first);
  const b = nameOf(story, second);
  const firstWas = was.get(first) ?? blank;
  const secondWas = was.get(second) ?? blank;
  const firstNow = now.get(first) ?? blank;
  const secondNow = now.get(second) ?? blank;
  const fields = differing([
    { name: 'What they are to each other', was: wasBond, now: stored.bond },
    { name: `How ${a} sees ${b}`, was: firstWas.sees, now: firstNow.sees },
    { name: `What ${a} hides from ${b}`, was: firstWas.hides, now: firstNow.hides },
    { name: `How ${b} sees ${a}`, was: secondWas.sees, now: secondNow.sees },
    { name: `What ${b} hides from ${a}`, was: secondWas.hides, now: secondNow.hides },
  ]);
  if (!before) {
    return [{ subject: `${a} and ${b} are tied`, fields }];
  }
  if (fields.length === 0) {
    return [];
  }
  return [{ subject: `The relationship between ${a} and ${b}`, fields }];
}

function bookChange(story: Story, edit: Extract<StoryEdit, { kind: 'book' }>): ChangedView[] {
  const book = story.book;
  const choices = edit.book;
  const was = settingsView(book.length as Length, book.wordGoal, book.pov as Pov, book.darkness as Darkness);
  const now = settingsView(choices.length, WORD_GOALS[choices.length], choices.pov, choices.darkness);
  const changed: ChangedView[] = [];
  const bookFields = differing([
    { name: 'Title', was: book.title, now: choices.title },
    { name: 'Length', was: was.length, now: now.length },
    { name: 'Style', was: was.style, now: now.style },
    { name: 'Point of view', was: was.pov, now: now.pov },
    { name: 'How dark it goes', was: was.darkness, now: now.darkness },
  ]);
  if (bookFields.length > 0) {
    changed.push({ subject: 'The book', fields: bookFields });
  }
  const world = story.world ?? { genre: '', tone: '', setting: '', rules: '', notes: '' };
  const worldFields = differing([
    { name: 'Genre', was: world.genre, now: choices.world.genre },
    { name: 'Tone', was: world.tone, now: choices.world.tone },
    { name: 'Setting', was: world.setting, now: choices.world.setting },
    { name: 'Rules that matter', was: world.rules, now: choices.world.rules },
    { name: 'Notes', was: world.notes, now: choices.world.notes },
  ]);
  if (worldFields.length > 0) {
    changed.push({ subject: 'The world', fields: worldFields });
  }
  return changed;
}

/** What the change did, as Procreator is told it, from the story as it stood before. Empty when it changed nothing. */
export function changeNoteView(before: Story, edit: StoryEdit): ChangeNoteView {
  let changed: ChangedView[] = [];
  if (edit.kind === 'sheet') {
    changed = sheetChange(before, edit.character);
  } else if (edit.kind === 'join') {
    changed = joinChange(edit.character);
  } else if (edit.kind === 'leave') {
    changed = [{ subject: `${nameOf(before, edit.id)} leaves the story`, fields: [] }];
  } else if (edit.kind === 'line') {
    changed = lineChange(before, edit.relationship);
  } else if (edit.kind === 'untie') {
    const [first, second] = inCastOrder(before, edit.a, edit.b);
    changed = [{ subject: `${nameOf(before, first)} and ${nameOf(before, second)} are no longer tied`, fields: [] }];
  } else {
    changed = bookChange(before, edit);
  }
  return { changed };
}
