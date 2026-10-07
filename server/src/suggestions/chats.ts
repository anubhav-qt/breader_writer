import type { Message } from '@writer/pi-ai';
import { and, asc, desc, eq } from 'drizzle-orm';
import { ChangeList, type Chat, type ChatEntry } from '@writer/shared/chat';
import type { Db } from '../db/client.ts';
import { setupChatEntries, setupChatMessages, setupChats } from '../db/schema.ts';

/*
 * The Suggestions chat as it's kept: the chat, its messages as the model was sent them (in order,
 * only ever added to), and its entries, what the chat shows.
 */

export type ChatRow = typeof setupChats.$inferSelect;

type EntryRow = typeof setupChatEntries.$inferSelect;

/** Who said an entry. */
export type By = ChatEntry['by'];

/** Starts a chat: a book's, or with bookId null, a book's not made yet. */
export async function startChat(db: Db, userId: string, bookId: string | null): Promise<ChatRow> {
  const [chat] = await db.insert(setupChats).values({ userId, bookId }).returning();
  return chat;
}

/** The account's chat with this id, or null for anyone else's or none. */
export async function findChat(db: Db, userId: string, id: string): Promise<ChatRow | null> {
  const [chat] = await db
    .select()
    .from(setupChats)
    .where(and(eq(setupChats.id, id), eq(setupChats.userId, userId)));
  if (!chat) {
    return null;
  }
  return chat;
}

/** The book's latest chat, or null before it has one. */
export async function bookChat(db: Db, userId: string, bookId: string): Promise<ChatRow | null> {
  const [chat] = await db
    .select()
    .from(setupChats)
    .where(and(eq(setupChats.userId, userId), eq(setupChats.bookId, bookId)))
    .orderBy(desc(setupChats.createdAt))
    .limit(1);
  if (!chat) {
    return null;
  }
  return chat;
}

/** Keeps the page as Procreator was last sent it. */
export async function rememberPage(db: Db, chatId: string, page: string) {
  await db.update(setupChats).set({ page }).where(eq(setupChats.id, chatId));
}

/** Adds a message at the end of the chat. */
export async function addChatMessage(db: Db, chatId: string, message: Message) {
  await db.insert(setupChatMessages).values({ chatId, message });
}

/** The chat's messages, in order. */
export async function chatMessages(db: Db, chatId: string): Promise<Message[]> {
  const rows = await db
    .select()
    .from(setupChatMessages)
    .where(eq(setupChatMessages.chatId, chatId))
    .orderBy(asc(setupChatMessages.id));
  return rows.map((row) => row.message as Message);
}

/** Adds an entry at the end of what the chat shows. Returns its id. */
export async function addEntry(db: Db, chatId: string, by: By, text: string, list: ChangeList | null): Promise<number> {
  const [row] = await db.insert(setupChatEntries).values({ chatId, by, text, list }).returning();
  return row.id;
}

/** Changes an entry's list: an item redone, or how it stands. */
export async function setList(db: Db, entryId: number, list: ChangeList) {
  await db.update(setupChatEntries).set({ list }).where(eq(setupChatEntries.id, entryId));
}

function entryOf(row: EntryRow): ChatEntry {
  let list: ChangeList | null = null;
  if (row.list !== null) {
    list = ChangeList.parse(row.list);
  }
  let by: By = 'procreator';
  if (row.by === 'owner') {
    by = 'owner';
  }
  return { id: row.id, by, text: row.text, list };
}

/** The chat's entries, in order. */
export async function chatEntries(db: Db, chatId: string): Promise<ChatEntry[]> {
  const rows = await db
    .select()
    .from(setupChatEntries)
    .where(eq(setupChatEntries.chatId, chatId))
    .orderBy(asc(setupChatEntries.id));
  return rows.map(entryOf);
}

/** The chat as it shows. */
export async function readChat(db: Db, chat: ChatRow): Promise<Chat> {
  const entries = await chatEntries(db, chat.id);
  return { id: chat.id, entries };
}

/** The chat's newest list still waiting on the owner, and its entry's id, or null. */
export async function openList(db: Db, chatId: string): Promise<{ entryId: number; list: ChangeList } | null> {
  const entries = await chatEntries(db, chatId);
  for (const entry of entries.toReversed()) {
    if (entry.list && entry.list.state === 'open') {
      return { entryId: entry.id, list: entry.list };
    }
  }
  return null;
}

/** Whether Procreator's last list was approved since the owner last said anything. */
export async function justApproved(db: Db, chatId: string): Promise<boolean> {
  const [last] = await db
    .select()
    .from(setupChatEntries)
    .where(eq(setupChatEntries.chatId, chatId))
    .orderBy(desc(setupChatEntries.id))
    .limit(1);
  if (!last) {
    return false;
  }
  const entry = entryOf(last);
  if (entry.by !== 'procreator' || !entry.list) {
    return false;
  }
  return entry.list.state === 'approved';
}

/** Sets aside the chat's open list, if there is one: the owner said something else instead. */
export async function setAside(db: Db, chatId: string) {
  const open = await openList(db, chatId);
  if (!open) {
    return;
  }
  await setList(db, open.entryId, { ...open.list, state: 'set_aside' });
}
