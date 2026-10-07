import { randomUUID } from 'node:crypto';
import { Type, type Static } from '@writer/pi-ai';
import { Darkness, Length, NAME_LIMIT, Pov, everyone, pairKey, type BookSetup, type Character } from '@writer/shared/book';
import { applyChange, type SetupChange } from '@writer/shared/chat';
import { undashed } from '../ai/dashes.ts';
import { fieldKey, fieldLimit, type FieldRef, type SheetField, type SideField, type WorldField } from '@writer/shared/suggestions';
import { refsOf } from './view.ts';

/*
 * The changes Procreator lists in the Suggestions chat, from what it writes (a person by name, a
 * field by its name) to exactly what will land on the page (a person by id). Each list is checked
 * against the page as it stands, one item after another, so the list lands whole once approved;
 * what doesn't fit comes back to Procreator item by item, saying how to put it right.
 */

const FIELD_NAMES = [
  'title',
  'length',
  'pov',
  'darkness',
  'genre',
  'tone',
  'setting',
  'rules',
  'notes',
  'name',
  'who',
  'personality',
  'past',
  'bond',
  'sees',
  'hides',
] as const;
type FieldName = (typeof FIELD_NAMES)[number];

const KINDS = ['set', 'add', 'remove', 'untie'] as const;
type Kind = (typeof KINDS)[number];

/** A change as Procreator writes it, in the tools' arguments. */
export const ChangeArgs = Type.Object({
  // Strings with their values listed, which every provider's schema checks take.
  kind: Type.Unsafe<Kind>({
    type: 'string',
    enum: [...KINDS],
    description:
      'set: a field gets its whole new text. add: someone new joins the cast, with their sheet. remove: someone leaves the cast, and their lines go with them. untie: the line between two goes.',
  }),
  field: Type.Optional(
    Type.Unsafe<FieldName>({
      type: 'string',
      enum: [...FIELD_NAMES],
      description:
        "For set, which field. The book's: title, length, pov, darkness. The world's: genre, tone, setting, rules, notes. Someone's sheet, with person: name, who (who they are), personality, past, notes. A line, with person and other: bond (what the two are to each other), sees (how person sees other), hides (what person hides from other); two who aren't tied yet are tied by it.",
    }),
  ),
  person: Type.Optional(
    Type.String({
      description:
        "Who it's about, by name as the page gives it (Unnamed 1 and so on for someone with no name yet). For add, the new person's name. For sees and hides, whose side it is.",
    }),
  ),
  other: Type.Optional(Type.String({ description: "For a line's field, and for untie: the other one, by name." })),
  text: Type.Optional(
    Type.String({
      description:
        'For set, what the field will say, whole and word for word: it replaces what is there, so keep whatever should stay. For length: short_story, novella, light_novel or novel. For pov: third_close, first or third_omniscient. For darkness: gentle, mature or unflinching.',
    }),
  ),
  sheet: Type.Optional(
    Type.Object(
      {
        who: Type.Optional(Type.String()),
        personality: Type.Optional(Type.String()),
        past: Type.Optional(Type.String()),
        notes: Type.Optional(Type.String()),
      },
      { description: 'For add, their sheet: who they are, personality, past, notes. Leave out what the story can fill in.' },
    ),
  ),
});
export type ChangeArgs = Static<typeof ChangeArgs>;

/** A change that doesn't fit the page, and how to put it right. */
class Problem extends Error {}

const WORLD_FIELDS: Record<string, WorldField> = { genre: 'genre', tone: 'tone', setting: 'setting', rules: 'rules' };
const SHEET_FIELDS: Record<string, SheetField> = { name: 'name', who: 'who', personality: 'personality', past: 'past' };
const SIDE_FIELDS: Record<string, SideField> = { sees: 'sees', hides: 'hides' };

/**
 * Finds people by name: on the page as Procreator saw it, else as the list has changed it so far
 * (someone it adds, or renames). The page as it saw it comes first, since naming someone can
 * renumber the nameless ones after them.
 */
class Names {
  private readonly seen: Map<string, string>;
  private readonly now: Map<string, string>;

  constructor(page: BookSetup, original: BookSetup) {
    this.seen = byName(original);
    this.now = byName(page);
  }

  /** The id of someone named so, or a Problem saying no one is. */
  find(name: string | undefined, role: 'person' | 'other'): string {
    if (name === undefined || name.trim() === '') {
      throw new Problem(`it needs ${role}, a name from the page.`);
    }
    const key = name.trim().toLowerCase();
    const id = this.seen.get(key) ?? this.now.get(key);
    if (!id) {
      throw new Problem(`no one on the page is called ${name.trim()}. Use a name as the page gives it, or add them earlier in the list.`);
    }
    return id;
  }
}

/** Everyone's ref (their name, Unnamed 1, Mara (2)), and plain names that only one person has. */
function byName(page: BookSetup): Map<string, string> {
  const names = new Map<string, string>();
  for (const [id, ref] of refsOf(page)) {
    names.set(ref.toLowerCase(), id);
  }
  const counts = new Map<string, number>();
  for (const person of everyone(page)) {
    const key = person.name.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const person of everyone(page)) {
    const key = person.name.trim().toLowerCase();
    if (key !== '' && counts.get(key) === 1) {
      names.set(key, person.id);
    }
  }
  return names;
}

function needText(args: ChangeArgs): string {
  if (args.text === undefined) {
    throw new Problem("set needs the field's new text.");
  }
  return undashed(args.text.trim());
}

function fitsField(field: FieldRef, text: string, what: string): string {
  const most = fieldLimit(field);
  if (text.length > most) {
    throw new Problem(`${what} holds ${most} characters at most, and that's ${text.length}.`);
  }
  return text;
}

/** A choice of the book's: its length, point of view or how dark it goes. */
function choiceOf(field: FieldName, text: string): SetupChange {
  if (field === 'length') {
    const value = Length.safeParse(text);
    if (!value.success) {
      throw new Problem('length is one of short_story, novella, light_novel or novel.');
    }
    return { kind: 'length', value: value.data };
  }
  if (field === 'pov') {
    const value = Pov.safeParse(text);
    if (!value.success) {
      throw new Problem('pov is one of third_close, first or third_omniscient.');
    }
    return { kind: 'pov', value: value.data };
  }
  const value = Darkness.safeParse(text);
  if (!value.success) {
    throw new Problem('darkness is one of gentle, mature or unflinching.');
  }
  return { kind: 'darkness', value: value.data };
}

/** The field a set is about, finding whose it is by name. */
function fieldOf(args: ChangeArgs, field: FieldName, names: Names): FieldRef {
  if (field === 'title') {
    return { kind: 'title' };
  }
  if (WORLD_FIELDS[field]) {
    return { kind: 'world', field: WORLD_FIELDS[field] };
  }
  if (field === 'notes' && !args.person) {
    return { kind: 'world', field: 'notes' };
  }
  if (field === 'notes') {
    return { kind: 'character', id: names.find(args.person, 'person'), field: 'notes' };
  }
  if (SHEET_FIELDS[field]) {
    return { kind: 'character', id: names.find(args.person, 'person'), field: SHEET_FIELDS[field] };
  }
  const one = names.find(args.person, 'person');
  const other = names.find(args.other, 'other');
  if (one === other) {
    throw new Problem('a line is between two different people.');
  }
  if (field === 'bond') {
    return { kind: 'bond', a: one, b: other };
  }
  return { kind: 'side', id: one, other, field: SIDE_FIELDS[field] };
}

function setChange(args: ChangeArgs, names: Names): SetupChange {
  if (!args.field) {
    throw new Problem('set needs a field.');
  }
  const text = needText(args);
  if (args.field === 'length' || args.field === 'pov' || args.field === 'darkness') {
    return choiceOf(args.field, text);
  }
  const field = fieldOf(args, args.field, names);
  if (field.kind === 'character' && field.field === 'name' && text === '') {
    throw new Problem("a name can't be blank.");
  }
  return { kind: 'field', field, text: fitsField(field, text, `the ${args.field} field`) };
}

function sheetText(text: string | undefined, field: SheetField, id: string): string {
  if (text === undefined) {
    return '';
  }
  const trimmed = undashed(text.trim());
  return fitsField({ kind: 'character', id, field }, trimmed, `a sheet's ${field}`);
}

function addChange(args: ChangeArgs, page: BookSetup): SetupChange {
  const name = (args.person ?? '').trim();
  if (name === '') {
    throw new Problem("add needs the new person's name, in person.");
  }
  if (name.length > NAME_LIMIT) {
    throw new Problem(`a name holds ${NAME_LIMIT} characters at most.`);
  }
  const taken = everyone(page).some((person) => person.name.trim().toLowerCase() === name.toLowerCase());
  if (taken) {
    throw new Problem(`someone on the page is called ${name} already. Give the new person a name of their own.`);
  }
  const id = randomUUID();
  const sheet = args.sheet ?? {};
  const person: Character = {
    id,
    name,
    who: sheetText(sheet.who, 'who', id),
    personality: sheetText(sheet.personality, 'personality', id),
    past: sheetText(sheet.past, 'past', id),
    notes: sheetText(sheet.notes, 'notes', id),
  };
  return { kind: 'add', person };
}

function removeChange(args: ChangeArgs, page: BookSetup, names: Names): SetupChange {
  const id = names.find(args.person, 'person');
  if (id === page.protagonist.id) {
    throw new Problem(`${args.person} is the one the owner plays, and stays.`);
  }
  return { kind: 'remove', id };
}

function untieChange(args: ChangeArgs, names: Names): SetupChange {
  const one = names.find(args.person, 'person');
  const other = names.find(args.other, 'other');
  return { kind: 'untie', a: one, b: other };
}

/** A change as it will land, from what Procreator wrote, or a Problem. */
function resolve(args: ChangeArgs, page: BookSetup, names: Names): SetupChange {
  if (args.kind === 'set') {
    return setChange(args, names);
  }
  if (args.kind === 'add') {
    return addChange(args, page);
  }
  if (args.kind === 'remove') {
    return removeChange(args, page, names);
  }
  return untieChange(args, names);
}

/** Why a change that was understood still doesn't fit the page. */
function misfit(change: SetupChange): string {
  if (change.kind === 'add') {
    return 'the cast is full.';
  }
  if (change.kind === 'untie') {
    return "those two aren't tied.";
  }
  if (change.kind === 'remove') {
    return "they aren't on the page.";
  }
  return "it doesn't fit the page as it stands.";
}

/** One item checked against the page as the list has changed it so far: the change, and the page after it. */
function landItem(args: ChangeArgs, page: BookSetup, original: BookSetup): { change: SetupChange; page: BookSetup } {
  const names = new Names(page, original);
  const change = resolve(args, page, names);
  const after = applyChange(page, change);
  if (!after) {
    throw new Problem(misfit(change));
  }
  return { change, page: after };
}

/** A list checked against the page: every change as it will land, or what's wrong with each item that doesn't fit. */
export type Checked = { ok: true; items: SetupChange[] } | { ok: false; problems: string[] };

/** Checks a list against the page, item by item, in order, as it would land. */
export function checkList(list: ChangeArgs[], original: BookSetup): Checked {
  if (list.length === 0) {
    return { ok: false, problems: ['The list is empty. If nothing should change, say so instead of making a list.'] };
  }
  let page = original;
  const items: SetupChange[] = [];
  const problems: string[] = [];
  for (const [index, args] of list.entries()) {
    try {
      const item = landItem(args, page, original);
      items.push(item.change);
      page = item.page;
    } catch (err) {
      if (!(err instanceof Problem)) {
        throw err;
      }
      problems.push(`Item ${index + 1}: ${err.message}`);
    }
  }
  if (problems.length > 0) {
    return { ok: false, problems };
  }
  return { ok: true, items };
}

/** The items of a list that still fit the page, landed one after another, in order. */
export function stillFitting(page: BookSetup, items: SetupChange[]): SetupChange[] {
  let changed = page;
  const fitting: SetupChange[] = [];
  for (const item of items) {
    const after = applyChange(changed, item);
    if (after) {
      changed = after;
      fitting.push(item);
    }
  }
  return fitting;
}

/** The page with a list's items landed, as many of them as still fit. */
export function landed(page: BookSetup, items: SetupChange[]): BookSetup {
  let changed = page;
  for (const item of items) {
    const after = applyChange(changed, item);
    if (after) {
      changed = after;
    }
  }
  return changed;
}

/** Whether two changes change the same thing: one field, one of the book's choices, one person or one line. */
function sameThing(one: SetupChange, other: SetupChange): boolean {
  if (one.kind === 'field' && other.kind === 'field') {
    return fieldKey(one.field) === fieldKey(other.field);
  }
  if (one.kind === 'remove' && other.kind === 'remove') {
    return one.id === other.id;
  }
  if (one.kind === 'untie' && other.kind === 'untie') {
    return pairKey(one.a, one.b) === pairKey(other.a, other.b);
  }
  return one.kind === other.kind;
}

/** The change redone, in the item's place: someone added keeps the id the items after it know them by. */
function inPlaceOf(change: SetupChange, item: SetupChange): SetupChange {
  if (change.kind === 'add' && item.kind === 'add') {
    return { kind: 'add', person: { ...change.person, id: item.person.id } };
  }
  return change;
}

/**
 * Checks item `index` of a list redone, against the page with the items before it landed. It has
 * to change what the item changed (it's redone in place). The change as it will land, or what's
 * wrong with it.
 */
export function checkRedo(
  args: ChangeArgs,
  original: BookSetup,
  items: SetupChange[],
  index: number,
): { ok: true; change: SetupChange } | { ok: false; problem: string } {
  const item = items[index];
  const page = landed(original, items.slice(0, index));
  try {
    const redone = landItem(args, page, original);
    if (!sameThing(redone.change, item)) {
      throw new Problem(`that changes something else. Item ${index + 1} is redone in place, so it changes what it changed before, as the request gives it.`);
    }
    return { ok: true, change: inPlaceOf(redone.change, item) };
  } catch (err) {
    if (!(err instanceof Problem)) {
      throw err;
    }
    return { ok: false, problem: err.message };
  }
}

/**
 * How Procreator calls each person: as on the page it saw, else as on the page the list has made
 * (someone it adds). The same order Names finds them in.
 */
function namesFor(page: BookSetup, original: BookSetup): Map<string, string> {
  const names = refsOf(page);
  for (const [id, ref] of refsOf(original)) {
    names.set(id, ref);
  }
  return names;
}

/** Someone as Procreator calls them. */
function nameOf(names: Map<string, string>, id: string): string {
  const name = names.get(id);
  if (name === undefined) {
    return '';
  }
  return name;
}

/** A field's change as Procreator writes it. */
function fieldArgs(field: FieldRef, text: string, names: Map<string, string>): ChangeArgs {
  if (field.kind === 'title') {
    return { kind: 'set', field: 'title', text };
  }
  if (field.kind === 'world') {
    return { kind: 'set', field: field.field, text };
  }
  if (field.kind === 'character') {
    return { kind: 'set', field: field.field, person: nameOf(names, field.id), text };
  }
  if (field.kind === 'bond') {
    return { kind: 'set', field: 'bond', person: nameOf(names, field.a), other: nameOf(names, field.b), text };
  }
  return { kind: 'set', field: field.field, person: nameOf(names, field.id), other: nameOf(names, field.other), text };
}

/**
 * Item `index` of a list as Procreator writes a change, people by name: for asking it to redo
 * the item, which says what the item is now.
 */
export function argsOf(original: BookSetup, items: SetupChange[], index: number): ChangeArgs {
  const change = items[index];
  const page = landed(original, items.slice(0, index));
  const names = namesFor(page, original);
  if (change.kind === 'field') {
    return fieldArgs(change.field, change.text, names);
  }
  if (change.kind === 'length' || change.kind === 'pov' || change.kind === 'darkness') {
    return { kind: 'set', field: change.kind, text: change.value };
  }
  if (change.kind === 'add') {
    const person = change.person;
    const sheet = { who: person.who, personality: person.personality, past: person.past, notes: person.notes };
    return { kind: 'add', person: person.name, sheet };
  }
  if (change.kind === 'remove') {
    return { kind: 'remove', person: nameOf(names, change.id) };
  }
  return { kind: 'untie', person: nameOf(names, change.a), other: nameOf(names, change.b) };
}
