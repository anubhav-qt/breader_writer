import { everyone, type BookSetup } from '@writer/shared/book';
import { BookChat, Chat, ChatApproved, ChatEvent, type ChatApprove, type ChatRedo, type ChatSay, type SetupChange } from '@writer/shared/chat';
import type { FieldRef, SheetField, WorldField } from '@writer/shared/suggestions';
import { streamEvents, writer } from '../lib/api';
import { LENGTH_NAMES } from './books';
import { DARKNESS, POVS } from './setup';

/*
 * The Suggestions chat (step 5), from the writer's server, and its lists as the chat shows them.
 */

/** How long a redo may take: Procreator thinks as hard as the account picked. */
const REDO_TIMEOUT = 180_000;

/** The book's chat, or null before it has one. */
export async function bookChat(bookId: string): Promise<Chat | null> {
  const data = await writer.get<unknown>(`/v1/suggestions/chats?book=${bookId}`);
  return BookChat.parse(data).chat;
}

/** A chat by its id. */
export async function readChat(chatId: string): Promise<Chat> {
  const data = await writer.get<unknown>(`/v1/suggestions/chats/${chatId}`);
  return Chat.parse(data);
}

/** The owner says something. What comes back streams to onEvent: the chat's id, the words, then the chat. */
export async function sayInChat(ask: ChatSay, onEvent: (event: ChatEvent) => void, signal: AbortSignal): Promise<void> {
  await streamEvents('/v1/suggestions/chats', ask, (data) => onEvent(ChatEvent.parse(data)), signal);
}

/** One item of the open list redone. Answers with the chat. */
export async function redoItem(chatId: string, ask: ChatRedo): Promise<Chat> {
  const data = await writer.post<unknown>(`/v1/suggestions/chats/${chatId}/redo`, ask, REDO_TIMEOUT);
  return Chat.parse(data);
}

/** The open list approved. Answers with the chat and the changes for the page to land. */
export async function approveList(chatId: string, ask: ChatApprove): Promise<ChatApproved> {
  const data = await writer.post<unknown>(`/v1/suggestions/chats/${chatId}/approve`, ask);
  return ChatApproved.parse(data);
}

/* A list's items, as the chat shows them. */

/** An item: where it lands, what it says, and for someone new, their sheet. */
export interface ItemView {
  where: string;
  text: string;
  details: { label: string; text: string }[];
}

const WORLD_LABELS: Record<WorldField, string> = {
  genre: 'genre',
  tone: 'tone',
  setting: 'setting',
  rules: 'rules that matter',
  notes: 'notes',
};

const SHEET_LABELS: Record<SheetField, string> = {
  name: 'name',
  who: 'who they are',
  personality: 'personality',
  past: 'past',
  notes: 'notes',
};

/** Everyone's name, as the page has it, and the list's newcomers too. */
function namesOf(setup: BookSetup, items: SetupChange[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const person of everyone(setup)) {
    let name = person.name.trim();
    if (!name && person.id === setup.protagonist.id) {
      name = 'The one you play';
    } else if (!name) {
      name = 'No name yet';
    }
    names.set(person.id, name);
  }
  for (const item of items) {
    if (item.kind === 'add') {
      names.set(item.person.id, item.person.name);
    }
  }
  return names;
}

function nameIn(names: Map<string, string>, id: string): string {
  const name = names.get(id);
  if (name === undefined) {
    return 'Someone not on the page';
  }
  return name;
}

function fieldWhere(field: FieldRef, names: Map<string, string>): string {
  if (field.kind === 'title') {
    return 'Title';
  }
  if (field.kind === 'world') {
    return `The world: ${WORLD_LABELS[field.field]}`;
  }
  if (field.kind === 'character') {
    return `${nameIn(names, field.id)}’s sheet: ${SHEET_LABELS[field.field]}`;
  }
  if (field.kind === 'bond') {
    return `What ${nameIn(names, field.a)} and ${nameIn(names, field.b)} are to each other`;
  }
  if (field.field === 'sees') {
    return `How ${nameIn(names, field.id)} sees ${nameIn(names, field.other)}`;
  }
  return `What ${nameIn(names, field.id)} hides from ${nameIn(names, field.other)}`;
}

function choiceName<T extends string>(choices: { id: T; name: string }[], id: T): string {
  const choice = choices.find((each) => each.id === id);
  if (!choice) {
    return id;
  }
  return choice.name;
}

/** An item of a list as the chat shows it, its people named as the page has them now. */
export function itemView(change: SetupChange, setup: BookSetup, items: SetupChange[]): ItemView {
  const names = namesOf(setup, items);
  if (change.kind === 'field') {
    return { where: fieldWhere(change.field, names), text: change.text, details: [] };
  }
  if (change.kind === 'length') {
    return { where: 'Length', text: LENGTH_NAMES[change.value], details: [] };
  }
  if (change.kind === 'pov') {
    return { where: 'Point of view', text: choiceName(POVS, change.value), details: [] };
  }
  if (change.kind === 'darkness') {
    return { where: 'How dark it goes', text: choiceName(DARKNESS, change.value), details: [] };
  }
  if (change.kind === 'add') {
    const person = change.person;
    const sheet = [
      { label: 'Who they are', text: person.who },
      { label: 'Personality', text: person.personality },
      { label: 'Past', text: person.past },
      { label: 'Notes', text: person.notes },
    ];
    const details = sheet.filter((line) => line.text.trim() !== '');
    return { where: 'Someone new', text: person.name, details };
  }
  if (change.kind === 'remove') {
    return { where: 'Leaves the cast', text: nameIn(names, change.id), details: [] };
  }
  return { where: 'No longer tied', text: `${nameIn(names, change.a)} and ${nameIn(names, change.b)}`, details: [] };
}
