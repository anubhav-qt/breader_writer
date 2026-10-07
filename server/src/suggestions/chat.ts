import { runAgentLoop, type AgentContext, type AgentEvent, type AgentLoopConfig, type AgentMessage, type AgentTool, type AgentToolResult } from '@writer/pi-agent';
import { streamSimple, toToolDeclaration, Type, type AssistantMessage, type Message, type SystemMessage, type UserMessage } from '@writer/pi-ai';
import type { BookSetup } from '@writer/shared/book';
import type { Chat, ChatApproved, ChangeList, SetupChange } from '@writer/shared/chat';
import type { DraftSetup } from '@writer/shared/suggestions';
import { counted, ModelError, recordCall, textOf, thinkingOf, type CallTag, type Sent } from '../ai/call.ts';
import { undashed, Undasher } from '../ai/dashes.ts';
import { render } from '../prompts/render.ts';
import { ChangeArgs, argsOf, checkList, checkRedo, stillFitting } from './changes.ts';
import {
  addChatMessage,
  addEntry,
  chatMessages,
  justApproved,
  openList,
  readChat,
  rememberPage,
  setAside,
  setList,
  type ChatRow,
} from './chats.ts';
import type { Helper } from './quick.ts';
import { refsOf, setupView } from './view.ts';

/*
 * The Suggestions chat (step 5): the owner talks the setup over with Procreator, which lists the
 * changes it will make once they're agreed (propose_changes), and redoes one item of the list
 * when the owner writes notes on it (revise_change). It runs on the account's own model, thinking
 * as hard as the account picked, since this is the owner's story being shaped.
 *
 * The chat is one session, only ever added to at its end, so each call sends what the one before
 * sent and the provider's cache can hold it. The page goes in an owner's message only once it has
 * changed since Procreator last saw it.
 */

/** A list or an item of one is still being shown; the owner decides next. */
const SHOWN_LIST = 'The owner sees your list now, with Approve under it. Wait for them.';
const SHOWN_ITEM = 'The owner sees the item redone, in its place in your list. Wait for them.';

/** Thrown when the chat can't do what was asked of it, with the owner's words for why. */
export class ChatError extends Error {}

/** What an exchange is for: the owner saying something, or one item of the open list redone. */
type Mode = { kind: 'say' } | { kind: 'redo'; items: SetupChange[]; item: number };

/** What the tools made of the exchange: a new list, or the item redone. */
interface Outcome {
  list: SetupChange[] | null;
  redone: SetupChange | null;
}

type Result = AgentToolResult<Record<string, never>>;

function shown(text: string): Result {
  return { content: [{ type: 'text', text }], details: {}, terminate: true };
}

const ProposeChanges = Type.Object({
  note: Type.String({
    description: 'What you say to the owner about the list, in a line or two: what it does, and why where that helps. It shows above the list.',
  }),
  changes: Type.Array(ChangeArgs, { description: 'Every change, in the order they should land.' }),
});

/**
 * Lists changes for the owner to approve. Its note is shown as Procreator's words (onNote), once
 * the list fits the page.
 */
function proposeTool(mode: Mode, page: BookSetup, outcome: Outcome, onNote: (note: string) => void): AgentTool<typeof ProposeChanges> {
  return {
    name: 'propose_changes',
    label: 'Propose changes',
    description:
      'Shows the owner a list of changes to the setup page, each exactly as it will land, with Approve under it. Nothing changes until they approve it. Call it once a change is settled, with every change agreed and nothing else.',
    parameters: ProposeChanges,
    execute: async (_id, params) => {
      if (mode.kind === 'redo') {
        throw new Error(`Redo only item ${mode.item + 1}, with revise_change.`);
      }
      const checked = checkList(params.changes, page);
      if (!checked.ok) {
        const problems = checked.problems.join('\n');
        throw new Error(`${problems}\nNothing was shown to the owner. Put those right and call propose_changes again, with the whole list.`);
      }
      outcome.list = checked.items;
      onNote(params.note);
      return shown(SHOWN_LIST);
    },
  };
}

const ReviseChange = Type.Object({
  change: ChangeArgs,
});

function reviseTool(mode: Mode, page: BookSetup, outcome: Outcome): AgentTool<typeof ReviseChange> {
  return {
    name: 'revise_change',
    label: 'Revise a change',
    description:
      "Redoes the one item of your list the owner asked you to redo, in its place: the change it will make instead, exactly as it will land. Nothing else on the list changes.",
    parameters: ReviseChange,
    execute: async (_id, params) => {
      if (mode.kind === 'say') {
        throw new Error("There's no item to redo. To change your list, make a new one with propose_changes.");
      }
      const checked = checkRedo(params.change, page, mode.items, mode.item);
      if (!checked.ok) {
        throw new Error(`${checked.problem} Put it right and call revise_change again.`);
      }
      outcome.redone = checked.change;
      return shown(SHOWN_ITEM);
    },
  };
}

/** The page as Procreator is sent it. */
function pageText(setup: DraftSetup): string {
  return render('suggestions/chat-page.njk', { page: setupView(setup, refsOf(setup)) });
}

/** The page for a message: as it stands when it has changed since Procreator last saw it, else ''. */
function pageIfChanged(chat: ChatRow, setup: DraftSetup): string {
  const page = pageText(setup);
  if (page === chat.page) {
    return '';
  }
  return page;
}

/** Keeps an exchange as it goes: each message in the chat, each call recorded, and Procreator's words. */
class Keeper {
  /** Procreator's latest message. */
  last: AssistantMessage | null = null;
  private sent: Sent | null = null;
  /** The words of each of Procreator's replies so far. */
  private readonly texts: string[] = [];
  /** Whether the reply being written has passed any words on yet. */
  private started = false;
  /** The reply's words without dashes, as they stream (see ai/dashes.ts). */
  private readonly undasher = new Undasher();
  private readonly helper: Helper;
  private readonly chat: ChatRow;
  private readonly onText: (delta: string) => void;

  constructor(helper: Helper, chat: ChatRow, onText: (delta: string) => void) {
    this.helper = helper;
    this.chat = chat;
    this.onText = onText;
  }

  /** A call is about to go: when, and what it holds. */
  sending(messages: AgentMessage[]) {
    this.sent = { startedAt: new Date(), estimate: counted(messages) };
  }

  async keep(event: AgentEvent) {
    if (event.type === 'message_update') {
      this.stream(event);
      return;
    }
    if (event.type !== 'message_end') {
      return;
    }
    const message = event.message as Message;
    if (message.role === 'system') {
      return;
    }
    await addChatMessage(this.helper.db, this.chat.id, message);
    if (message.role !== 'assistant') {
      return;
    }
    this.last = message;
    this.pass(this.undasher.flush());
    const text = undashed(textOf(message).trim());
    if (text !== '') {
      this.texts.push(text);
    }
    const tag: CallTag = { userId: this.helper.userId, bookId: this.chat.bookId, sceneId: null, turnId: null, role: 'setup' };
    const sent = this.sent ?? { startedAt: new Date(), estimate: 0 };
    await recordCall(this.helper.db, tag, this.helper.inUse, sent, message);
  }

  /** Passes Procreator's words on as they come. */
  private stream(event: Extract<AgentEvent, { type: 'message_update' }>) {
    const update = event.assistantMessageEvent;
    if (update.type !== 'text_delta') {
      return;
    }
    this.pass(this.undasher.push(update.delta));
  }

  /** Passes words of the reply being written on, a blank line between one reply and the next. */
  private pass(words: string) {
    if (words === '') {
      return;
    }
    if (!this.started && this.texts.length > 0) {
      this.onText('\n\n');
    }
    this.started = true;
    this.onText(words);
  }

  /** Words Procreator gave a tool to show (a list's note), as if it had written them. */
  add(text: string) {
    const words = undashed(text.trim());
    if (words === '') {
      return;
    }
    if (this.texts.length > 0) {
      this.onText('\n\n');
    }
    this.onText(words);
    this.texts.push(words);
  }

  /** A new reply starts: its words go after a blank line. */
  nextReply() {
    this.started = false;
  }

  /** Everything Procreator said in the exchange. */
  words(): string {
    return this.texts.join('\n\n');
  }
}

/** Runs one exchange: the chat as it stands, then this message. Throws a ModelError when the model doesn't answer. */
async function exchange(helper: Helper, chat: ChatRow, setup: DraftSetup, mode: Mode, text: string, onText: (delta: string) => void) {
  const outcome: Outcome = { list: null, redone: null };
  const keeper = new Keeper(helper, chat, onText);
  const tools: AgentTool[] = [proposeTool(mode, setup, outcome, (note) => keeper.add(note)), reviseTool(mode, setup, outcome)];
  const system: SystemMessage = {
    role: 'system',
    content: render('suggestions/chat-system.njk', {}),
    toolsAdded: tools.map(toToolDeclaration),
    timestamp: 0,
  };
  const kept = await chatMessages(helper.db, chat.id);
  const context: AgentContext = { messages: [system, ...kept], tools };
  const prompt: UserMessage = { role: 'user', content: text, timestamp: Date.now() };

  // No cap on calls or time (quality first): a list that doesn't fit the page goes back to
  // Procreator to put right as often as it takes. A run that's stuck is stopped through the signal.
  const config: AgentLoopConfig = {
    model: helper.inUse.model,
    reasoning: thinkingOf(helper.inUse),
    apiKey: helper.catalog.proxy.apiKey,
    // Keeps the chat's calls on one cache, where the provider keys its cache by session.
    sessionId: chat.id,
    cacheRetention: 'long',
    toolExecution: 'sequential',
    convertToLlm: (messages) => messages as Message[],
    prepareRequest: (request) => {
      keeper.sending(request.context.messages);
      keeper.nextReply();
    },
  };
  await runAgentLoop([prompt], context, config, (event) => keeper.keep(event), helper.signal, streamSimple);

  const last = keeper.last;
  if (!last) {
    throw new ModelError('The model didn’t answer.');
  }
  if (last.stopReason === 'error' || last.stopReason === 'aborted') {
    throw new ModelError(last.errorMessage ?? 'The model didn’t answer.');
  }
  return { words: keeper.words(), outcome };
}

/**
 * The owner says something: an open list is set aside, and Procreator answers, streaming its words
 * through onText, with a new list if it makes one. Answers with the chat as it stands. Throws a
 * ModelError when the model doesn't answer; what the owner said is kept.
 */
export async function say(helper: Helper, chat: ChatRow, setup: DraftSetup, text: string, onText: (delta: string) => void): Promise<Chat> {
  const approved = await justApproved(helper.db, chat.id);
  await setAside(helper.db, chat.id);
  await addEntry(helper.db, chat.id, 'owner', text, null);

  const page = pageIfChanged(chat, setup);
  const message = render('suggestions/chat-say.njk', { page, approved, text });
  if (page !== '') {
    await rememberPage(helper.db, chat.id, page);
  }
  const done = await exchange(helper, chat, setup, { kind: 'say' }, message, onText);

  let list: ChangeList | null = null;
  if (done.outcome.list) {
    list = { items: done.outcome.list, state: 'open' };
  }
  await addEntry(helper.db, chat.id, 'procreator', done.words, list);
  return readChat(helper.db, chat);
}

/** The open list an entry holds, or a ChatError saying it isn't open. */
async function listToRedo(helper: Helper, chat: ChatRow, entryId: number): Promise<ChangeList> {
  const open = await openList(helper.db, chat.id);
  if (!open || open.entryId !== entryId) {
    throw new ChatError('That list isn’t open any more.');
  }
  return open.list;
}

/**
 * One item of the open list redone, as the owner's notes on it say, in its place. Answers with the
 * chat as it stands. Throws a ModelError when the model doesn't answer, and a ChatError when it
 * answers without redoing the item.
 */
export async function redo(helper: Helper, chat: ChatRow, setup: DraftSetup, entryId: number, item: number, notes: string): Promise<Chat> {
  const list = await listToRedo(helper, chat, entryId);
  if (item >= list.items.length) {
    throw new ChatError('That list has no such item.');
  }
  const page = pageIfChanged(chat, setup);
  // What the item is now, as Procreator writes a change, since it may have been redone already.
  const change = JSON.stringify(argsOf(setup, list.items, item));
  const message = render('suggestions/chat-redo.njk', { page, item: item + 1, change, notes });
  if (page !== '') {
    await rememberPage(helper.db, chat.id, page);
  }
  const mode: Mode = { kind: 'redo', items: list.items, item };
  const done = await exchange(helper, chat, setup, mode, message, () => {});
  const redone = done.outcome.redone;
  if (!redone) {
    throw new ChatError('Procreator didn’t redo it. Try again, or say what you want in the chat.');
  }
  // The list may have changed while Procreator worked, so it's read again.
  const current = await listToRedo(helper, chat, entryId);
  const items = current.items.map((each, index) => {
    if (index === item) {
      return redone;
    }
    return each;
  });
  await setList(helper.db, entryId, { ...current, items });
  return readChat(helper.db, chat);
}

/**
 * The owner approves the open list. Answers with the chat as it stands, and the changes for the
 * page to land: the list's items that still fit the page as it stands now.
 */
export async function approve(helper: Pick<Helper, 'db'>, chat: ChatRow, entryId: number, setup: DraftSetup): Promise<ChatApproved> {
  const open = await openList(helper.db, chat.id);
  if (!open || open.entryId !== entryId) {
    throw new ChatError('That list isn’t open any more.');
  }
  await setList(helper.db, entryId, { ...open.list, state: 'approved' });
  const changes = stillFitting(setup, open.list.items);
  return { chat: await readChat(helper.db, chat), changes };
}

/** The chats Procreator is answering in now: one exchange at a time in each. */
const busy = new Set<string>();

/** Runs work in a chat no one else is running in, or throws a ChatError. */
export async function alone<T>(chatId: string, work: () => Promise<T>): Promise<T> {
  if (busy.has(chatId)) {
    throw new ChatError('Procreator is still answering in this chat.');
  }
  busy.add(chatId);
  try {
    return await work();
  } finally {
    busy.delete(chatId);
  }
}
