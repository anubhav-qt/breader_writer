import { z } from 'zod';
import { CAST_LIMIT, Character, Darkness, Id, Length, Pov, RELATIONSHIP_LIMIT, type BookSetup } from './book.ts';
import { blankRelationship, findRelationship, withRelationship, withoutCharacter, withoutRelationship } from './setup.ts';
import { DraftSetup, FieldRef, characterById, withFieldText } from './suggestions.ts';

/*
 * The Suggestions chat (step 5): talking the setup over with Procreator, who lists the changes it
 * will make once they're agreed. Each item on the list is exactly what will land on the page; the
 * owner approves the list whole, or first has an item redone on its own (see CLAUDE.md).
 */

/** A change Procreator will make to the page, exactly as it will land. */
export const SetupChange = z.discriminatedUnion('kind', [
  /** A text field's whole new text. A line's field ties the two first, if they weren't. */
  z.object({ kind: z.literal('field'), field: FieldRef, text: z.string() }),
  z.object({ kind: z.literal('length'), value: Length }),
  z.object({ kind: z.literal('pov'), value: Pov }),
  z.object({ kind: z.literal('darkness'), value: Darkness }),
  /** Someone new, and their sheet. */
  z.object({ kind: z.literal('add'), person: Character }),
  z.object({ kind: z.literal('remove'), id: Id }),
  z.object({ kind: z.literal('untie'), a: Id, b: Id }),
]);
export type SetupChange = z.infer<typeof SetupChange>;

/** The two a line's field is between, or null for a field that isn't a line's. */
function lineOf(field: FieldRef): [string, string] | null {
  if (field.kind === 'bond') {
    return [field.a, field.b];
  }
  if (field.kind === 'side') {
    return [field.id, field.other];
  }
  return null;
}

/** The setup with a line between these two, tying them first if they weren't. Null if they can't be tied. */
function tied(setup: BookSetup, one: string, other: string): BookSetup | null {
  if (findRelationship(setup, one, other)) {
    return setup;
  }
  if (one === other) {
    return null;
  }
  if (!characterById(setup, one) || !characterById(setup, other)) {
    return null;
  }
  if (setup.relationships.length >= RELATIONSHIP_LIMIT) {
    return null;
  }
  return withRelationship(setup, blankRelationship(one, other));
}

function withField(setup: BookSetup, field: FieldRef, text: string): BookSetup | null {
  const pair = lineOf(field);
  if (!pair) {
    return withFieldText(setup, field, text);
  }
  const withLine = tied(setup, pair[0], pair[1]);
  if (!withLine) {
    return null;
  }
  return withFieldText(withLine, field, text);
}

function withSomeoneNew(setup: BookSetup, person: Character): BookSetup | null {
  if (characterById(setup, person.id)) {
    return null;
  }
  if (setup.cast.length >= CAST_LIMIT) {
    return null;
  }
  return { ...setup, cast: [...setup.cast, person] };
}

function withoutSomeone(setup: BookSetup, id: string): BookSetup | null {
  if (id === setup.protagonist.id) {
    return null;
  }
  if (!characterById(setup, id)) {
    return null;
  }
  return withoutCharacter(setup, id);
}

function untied(setup: BookSetup, one: string, other: string): BookSetup | null {
  if (!findRelationship(setup, one, other)) {
    return null;
  }
  return withoutRelationship(setup, one, other);
}

/**
 * The setup with a change made, or null when it doesn't fit the page: the person or the line it's
 * about isn't there (any more), or the cast or the graph is full.
 */
export function applyChange(setup: BookSetup, change: SetupChange): BookSetup | null {
  if (change.kind === 'field') {
    return withField(setup, change.field, change.text);
  }
  if (change.kind === 'length') {
    return { ...setup, length: change.value };
  }
  if (change.kind === 'pov') {
    return { ...setup, pov: change.value };
  }
  if (change.kind === 'darkness') {
    return { ...setup, darkness: change.value };
  }
  if (change.kind === 'add') {
    return withSomeoneNew(setup, change.person);
  }
  if (change.kind === 'remove') {
    return withoutSomeone(setup, change.id);
  }
  return untied(setup, change.a, change.b);
}

/**
 * A list of changes, and how it stands: open (waiting on the owner), approved (on the page), or
 * set aside (the owner said something else instead, which made a new list).
 */
export const ChangeList = z.object({
  items: z.array(SetupChange),
  state: z.enum(['open', 'approved', 'set_aside']),
});
export type ChangeList = z.infer<typeof ChangeList>;

/** Something said in the chat: the owner's words, or Procreator's, with its list if it made one. */
export const ChatEntry = z.object({
  id: z.number().int(),
  by: z.enum(['owner', 'procreator']),
  text: z.string(),
  list: ChangeList.nullable(),
});
export type ChatEntry = z.infer<typeof ChatEntry>;

/** A Suggestions chat, everything said in it in order. */
export const Chat = z.object({
  id: z.uuid(),
  entries: z.array(ChatEntry),
});
export type Chat = z.infer<typeof Chat>;

/** GET /v1/suggestions/chats?book=<id>: the book's chat, or null before it has one. */
export const BookChat = z.object({
  chat: Chat.nullable(),
});
export type BookChat = z.infer<typeof BookChat>;

/** The most characters the owner says in one go, or writes in an item's notes. */
export const SAY_LIMIT = 8000;

/**
 * POST /v1/suggestions/chats: the owner says something. The chat to say it in (null starts one:
 * the book's, or a new book's), the page as it stands, and their words.
 */
export const ChatSay = z.object({
  chatId: z.uuid().nullable(),
  bookId: z.uuid().nullable(),
  setup: DraftSetup,
  text: z.string().trim().min(1, 'Say something first.').max(SAY_LIMIT),
});
export type ChatSay = z.infer<typeof ChatSay>;

/** POST /v1/suggestions/chats/:id/redo: one item of a list redone, with the owner's notes on it. */
export const ChatRedo = z.object({
  entry: z.number().int(),
  item: z.number().int().min(0),
  notes: z.string().trim().min(1, 'Write what should change first.').max(SAY_LIMIT),
  setup: DraftSetup,
});
export type ChatRedo = z.infer<typeof ChatRedo>;

/** POST /v1/suggestions/chats/:id/approve: the list the owner approves. */
export const ChatApprove = z.object({
  entry: z.number().int(),
});
export type ChatApprove = z.infer<typeof ChatApprove>;

/**
 * What POST /v1/suggestions/chats streams, as server-sent events: Procreator's words as it writes
 * them, then the chat as it stands, or why it couldn't answer.
 */
export const ChatEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('started'), chatId: z.uuid() }),
  z.object({ type: z.literal('text'), delta: z.string() }),
  z.object({ type: z.literal('done'), chat: Chat }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string(), chat: Chat.nullable() }),
]);
export type ChatEvent = z.infer<typeof ChatEvent>;
