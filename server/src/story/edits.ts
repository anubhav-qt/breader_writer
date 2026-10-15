import { inOrder, WORD_GOALS, type Character, type Darkness, type Length, type Pov, type Relationship } from '@writer/shared/book';
import type { PageDraft, StoryEdit } from '@writer/shared/story';
import { namesOf } from './cast.ts';
import { linked } from './mentions.ts';
import type { Page } from './pages.ts';
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
  /** The change is to Procreator's memory, its notes on the work, not to the story. */
  memory: boolean;
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

const KIND_NAMES: Record<string, string> = {
  character: 'A character',
  place: 'A place',
  group: 'A group',
  thing: 'A thing',
  lore: 'Lore',
  story: 'The story’s own',
};

function kindName(kind: string): string {
  return KIND_NAMES[kind] ?? kind;
}

/** The page a draft changes, as it stood: by its id, or by its person for a character's. */
export function pageBefore(story: Story, draft: PageDraft): Page | null {
  if (draft.characterId !== null) {
    return story.pages.find((page) => page.characterId === draft.characterId) ?? null;
  }
  if (draft.id === null) {
    return null;
  }
  return story.pages.find((page) => page.id === draft.id) ?? null;
}

/** What a page is called in a note: someone's page by their name, any other by its title. */
function pageSubject(story: Story, page: { characterId: string | null; title: string }): string {
  if (page.characterId !== null) {
    return `${possessive(nameOf(story, page.characterId))} page`;
  }
  return `The page ${page.title}`;
}

function pageChange(story: Story, draft: PageDraft): ChangedView[] {
  const names = namesOf(story.characters);
  const before = pageBefore(story, draft);
  const was = { title: '', kind: '', about: '', body: '' };
  if (before) {
    was.title = before.title;
    was.kind = kindName(before.kind);
    was.about = before.about;
    was.body = linked(before.body, names);
  }
  const fields: { name: string; was: string; now: string }[] = [];
  if (draft.characterId === null) {
    fields.push({ name: 'Title', was: was.title, now: draft.title });
    fields.push({ name: 'Kind', was: was.kind, now: kindName(draft.kind) });
  }
  fields.push({ name: 'What it holds', was: was.about, now: draft.about });
  fields.push({ name: 'The page', was: was.body, now: draft.body });
  const changed = differing(fields);
  if (changed.length === 0) {
    return [];
  }
  if (!before && draft.characterId === null) {
    return [{ subject: `A new page, ${draft.title.trim()}`, fields: changed }];
  }
  return [{ subject: pageSubject(story, { characterId: draft.characterId, title: was.title }), fields: changed }];
}

function unpageChange(story: Story, id: string): ChangedView[] {
  const page = story.pages.find((each) => each.id === id);
  if (!page) {
    return [];
  }
  const body = linked(page.body, namesOf(story.characters));
  return [{ subject: `${pageSubject(story, page)} is taken out of the reference`, fields: differing([{ name: 'The page', was: body, now: '' }]) }];
}

/** A note as memory keeps it: on one line. */
function oneLine(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function noteChange(story: Story, id: number | null, text: string): ChangedView[] {
  const now = oneLine(text);
  if (id === null) {
    return [{ subject: 'A new note in your memory', fields: differing([{ name: 'Note', was: '', now }]) }];
  }
  const note = story.notes.find((each) => each.id === id);
  if (!note) {
    return [];
  }
  const was = linked(note.text, namesOf(story.characters));
  const fields = differing([{ name: 'Note', was, now }]);
  if (fields.length === 0) {
    return [];
  }
  return [{ subject: `Note ${id} in your memory`, fields }];
}

function forgetChange(story: Story, id: number): ChangedView[] {
  const note = story.notes.find((each) => each.id === id);
  if (!note) {
    return [];
  }
  const was = linked(note.text, namesOf(story.characters));
  return [{ subject: `Note ${id} in your memory is forgotten`, fields: differing([{ name: 'Note', was, now: '' }]) }];
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
  } else if (edit.kind === 'book') {
    changed = bookChange(before, edit);
  } else if (edit.kind === 'page') {
    changed = pageChange(before, edit.page);
  } else if (edit.kind === 'unpage') {
    changed = unpageChange(before, edit.id);
  } else if (edit.kind === 'note') {
    changed = noteChange(before, edit.id, edit.text);
  } else {
    changed = forgetChange(before, edit.id);
  }
  const memory = edit.kind === 'note' || edit.kind === 'forget';
  return { changed, memory };
}
