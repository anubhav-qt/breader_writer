import { desc, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { TITLE_LIMIT } from '@writer/shared/book';
import { ChatEvent, applyChange, type Chat, type SetupChange } from '@writer/shared/chat';
import { DraftSetup } from '@writer/shared/suggestions';
import type { Catalog } from '../src/ai/catalog.ts';
import { users } from '../src/db/breader.ts';
import { books, calls } from '../src/db/schema.ts';
import { argsOf, checkList, checkRedo, landed, type ChangeArgs } from '../src/suggestions/changes.ts';
import { ChatError, alone } from '../src/suggestions/chat.ts';
import { ORIGIN, account, address, call, deps, send, writer, type Writer } from './helpers.ts';
import { antigravity, catalogOf, fakeProxy, promptOf, textsOf, toolsOf, type FakeProxy, type Reply } from './proxy.ts';

const MARA = '11111111-1111-4111-8111-111111111111';
const IVEN = '22222222-2222-4222-8222-222222222222';
const NOBODY = '33333333-3333-4333-8333-333333333333';
const ANOTHER = '44444444-4444-4444-8444-444444444444';

/** A setup page part way filled in: someone without a name yet, a line between two, blanks. */
function page() {
  return {
    title: 'The Salt Queen',
    color: 'teal',
    length: 'novella',
    pov: 'third_close',
    darkness: 'mature',
    world: { genre: 'Fantasy', tone: '', setting: 'A drowned coast of stilt towns.', rules: '', notes: '' },
    protagonist: { id: MARA, name: 'Mara', who: 'A ferrywoman', personality: 'Stubborn, quick to laugh', past: '', notes: '' },
    cast: [
      { id: IVEN, name: 'Iven', who: 'Her uncle', personality: '', past: '', notes: '' },
      { id: NOBODY, name: '', who: '', personality: '', past: '', notes: '' },
    ],
    relationships: [{ bond: 'Family', a: { id: MARA, sees: 'He raised her.', hides: '' }, b: { id: IVEN, sees: '', hides: '' } }],
  };
}

function setupOf(raw: unknown) {
  return DraftSetup.parse(raw);
}

/** The changes a list that fits comes to, or the test fails saying why it didn't fit. */
function fits(list: ChangeArgs[], raw: unknown = page()): SetupChange[] {
  const checked = checkList(list, setupOf(raw));
  if (!checked.ok) {
    throw new Error(checked.problems.join('\n'));
  }
  return checked.items;
}

describe('checkList', () => {
  it('turns each change into exactly what will land, finding people by name', () => {
    const items = fits([
      { kind: 'set', field: 'tone', text: ' Wry and salt-stung ' },
      { kind: 'set', field: 'notes', text: 'The tide rules everything.' },
      { kind: 'set', field: 'notes', person: 'mara', text: 'Hates boats, secretly.' },
      { kind: 'set', field: 'bond', person: 'Iven', other: 'Unnamed 1', text: 'Debtor and lender' },
      { kind: 'set', field: 'hides', person: 'Unnamed 1', other: 'Iven', text: 'The ledger.' },
      { kind: 'set', field: 'length', text: 'light_novel' },
      { kind: 'set', field: 'darkness', text: 'gentle' },
    ]);
    expect(items).toEqual([
      { kind: 'field', field: { kind: 'world', field: 'tone' }, text: 'Wry and salt-stung' },
      { kind: 'field', field: { kind: 'world', field: 'notes' }, text: 'The tide rules everything.' },
      { kind: 'field', field: { kind: 'character', id: MARA, field: 'notes' }, text: 'Hates boats, secretly.' },
      { kind: 'field', field: { kind: 'bond', a: IVEN, b: NOBODY }, text: 'Debtor and lender' },
      { kind: 'field', field: { kind: 'side', id: NOBODY, other: IVEN, field: 'hides' }, text: 'The ledger.' },
      { kind: 'length', value: 'light_novel' },
      { kind: 'darkness', value: 'gentle' },
    ]);
  });

  it('finds someone added earlier in the list by their new name', () => {
    const items = fits([
      { kind: 'add', person: 'Oswin', sheet: { who: ' A smuggler ' } },
      { kind: 'set', field: 'sees', person: 'Oswin', other: 'Mara', text: 'An easy mark.' },
    ]);
    const added = items[0];
    if (added.kind !== 'add') {
      throw new Error('the first item should add someone');
    }
    expect(added.person).toMatchObject({ name: 'Oswin', who: 'A smuggler', personality: '', past: '', notes: '' });
    expect(items[1]).toEqual({
      kind: 'field',
      field: { kind: 'side', id: added.person.id, other: MARA, field: 'sees' },
      text: 'An easy mark.',
    });
  });

  it('knows the nameless by the numbers Procreator saw, after one of them is named', () => {
    const two = { ...page(), cast: [...page().cast, { id: ANOTHER, name: '', who: '', personality: '', past: '', notes: '' }] };
    const items = fits(
      [
        { kind: 'set', field: 'name', person: 'Unnamed 1', text: 'Oswin' },
        { kind: 'set', field: 'name', person: 'Unnamed 2', text: 'Pell' },
        { kind: 'set', field: 'past', person: 'Oswin', text: 'Ran salt past the tolls.' },
      ],
      two,
    );
    expect(items).toEqual([
      { kind: 'field', field: { kind: 'character', id: NOBODY, field: 'name' }, text: 'Oswin' },
      { kind: 'field', field: { kind: 'character', id: ANOTHER, field: 'name' }, text: 'Pell' },
      { kind: 'field', field: { kind: 'character', id: NOBODY, field: 'past' }, text: 'Ran salt past the tolls.' },
    ]);
  });

  it('says what’s wrong with each item that doesn’t fit, and how to put it right', () => {
    const checked = checkList(
      [
        { kind: 'set', field: 'past', person: 'Nobody', text: 'x' },
        { kind: 'remove', person: 'Mara' },
        { kind: 'untie', person: 'Iven', other: 'Unnamed 1' },
        { kind: 'set', field: 'name', person: 'Iven', text: '  ' },
        { kind: 'set', field: 'title', text: 'x'.repeat(TITLE_LIMIT + 1) },
        { kind: 'set', field: 'pov', text: 'second' },
        { kind: 'add', person: 'iven' },
        { kind: 'set', field: 'bond', person: 'Iven', other: 'iven', text: 'x' },
        { kind: 'set', person: 'Iven', text: 'x' },
        { kind: 'set', field: 'tone', text: 'Wry' },
      ],
      setupOf(page()),
    );
    expect(checked).toEqual({
      ok: false,
      problems: [
        'Item 1: no one on the page is called Nobody. Use a name as the page gives it, or add them earlier in the list.',
        'Item 2: Mara is the one the owner plays, and stays.',
        "Item 3: those two aren't tied.",
        "Item 4: a name can't be blank.",
        `Item 5: the title field holds ${TITLE_LIMIT} characters at most, and that's ${TITLE_LIMIT + 1}.`,
        'Item 6: pov is one of third_close, first or third_omniscient.',
        'Item 7: someone on the page is called iven already. Give the new person a name of their own.',
        'Item 8: a line is between two different people.',
        'Item 9: set needs a field.',
      ],
    });
  });

  it('turns away an empty list, and a change to someone the list removed', () => {
    const empty = checkList([], setupOf(page()));
    expect(empty).toEqual({ ok: false, problems: ['The list is empty. If nothing should change, say so instead of making a list.'] });
    const gone = checkList(
      [
        { kind: 'remove', person: 'Iven' },
        { kind: 'set', field: 'bond', person: 'Mara', other: 'Iven', text: 'Strangers' },
      ],
      setupOf(page()),
    );
    expect(gone).toEqual({ ok: false, problems: ["Item 2: it doesn't fit the page as it stands."] });
  });
});

describe('checkRedo', () => {
  it('checks the item against the page with the items before it landed', () => {
    const items = fits([
      { kind: 'add', person: 'Oswin' },
      { kind: 'set', field: 'past', person: 'Oswin', text: 'A fisherman.' },
    ]);
    const added = items[0];
    if (added.kind !== 'add') {
      throw new Error('the first item should add someone');
    }
    const redone = checkRedo({ kind: 'set', field: 'past', person: 'Oswin', text: 'A smuggler.' }, setupOf(page()), items, 1);
    expect(redone).toEqual({
      ok: true,
      change: { kind: 'field', field: { kind: 'character', id: added.person.id, field: 'past' }, text: 'A smuggler.' },
    });
  });

  it('keeps the item to what it changed', () => {
    const items = fits([
      { kind: 'set', field: 'tone', text: 'Wry' },
      { kind: 'set', field: 'bond', person: 'Mara', other: 'Iven', text: 'Family' },
    ]);
    const elsewhere = checkRedo({ kind: 'set', field: 'past', person: 'Iven', text: 'A fisherman.' }, setupOf(page()), items, 0);
    expect(elsewhere).toEqual({
      ok: false,
      problem: 'that changes something else. Item 1 is redone in place, so it changes what it changed before, as the request gives it.',
    });
    // A line's bond is the same field whichever way round the two are named.
    const turned = checkRedo({ kind: 'set', field: 'bond', person: 'Iven', other: 'Mara', text: 'Rivals' }, setupOf(page()), items, 1);
    expect(turned.ok).toBe(true);
  });

  it('keeps the id of someone added, which the items after know them by', () => {
    const items = fits([
      { kind: 'add', person: 'Oswin' },
      { kind: 'set', field: 'past', person: 'Oswin', text: 'A fisherman.' },
    ]);
    const added = items[0];
    if (added.kind !== 'add') {
      throw new Error('the first item should add someone');
    }
    const redone = checkRedo({ kind: 'add', person: 'Corin', sheet: { who: 'A smuggler' } }, setupOf(page()), items, 0);
    if (!redone.ok || redone.change.kind !== 'add') {
      throw new Error('the redo should add someone');
    }
    expect(redone.change.person).toEqual({ id: added.person.id, name: 'Corin', who: 'A smuggler', personality: '', past: '', notes: '' });
    const after = landed(setupOf(page()), [redone.change, items[1]]);
    expect(after.cast.at(-1)).toMatchObject({ name: 'Corin', past: 'A fisherman.' });
  });
});

describe('argsOf', () => {
  it('writes each item as Procreator does, so it reads back the same', () => {
    const items = fits([
      { kind: 'set', field: 'tone', text: 'Wry' },
      { kind: 'set', field: 'name', person: 'Unnamed 1', text: 'Oswin' },
      { kind: 'set', field: 'past', person: 'Unnamed 1', text: 'A smuggler.' },
      { kind: 'set', field: 'notes', person: 'Mara', text: 'Hates boats.' },
      { kind: 'set', field: 'bond', person: 'Iven', other: 'Oswin', text: 'Old partners' },
      { kind: 'set', field: 'sees', person: 'Oswin', other: 'Mara', text: 'An easy mark.' },
      { kind: 'set', field: 'pov', text: 'first' },
      { kind: 'untie', person: 'Mara', other: 'Iven' },
    ]);
    const args = items.map((_item, index) => argsOf(setupOf(page()), items, index));
    // People go by the names Procreator saw, as it found them.
    expect(args[2]).toEqual({ kind: 'set', field: 'past', person: 'Unnamed 1', text: 'A smuggler.' });
    expect(args[4]).toEqual({ kind: 'set', field: 'bond', person: 'Iven', other: 'Unnamed 1', text: 'Old partners' });
    expect(args[6]).toEqual({ kind: 'set', field: 'pov', text: 'first' });
    expect(fits(args)).toEqual(items);
  });

  it('writes someone added by name, with their sheet', () => {
    const items = fits([
      { kind: 'add', person: 'Pell', sheet: { who: 'A smuggler' } },
      { kind: 'set', field: 'past', person: 'Pell', text: 'Ran salt.' },
      { kind: 'remove', person: 'Iven' },
    ]);
    expect(argsOf(setupOf(page()), items, 0)).toEqual({
      kind: 'add',
      person: 'Pell',
      sheet: { who: 'A smuggler', personality: '', past: '', notes: '' },
    });
    expect(argsOf(setupOf(page()), items, 1)).toEqual({ kind: 'set', field: 'past', person: 'Pell', text: 'Ran salt.' });
    expect(argsOf(setupOf(page()), items, 2)).toEqual({ kind: 'remove', person: 'Iven' });
  });
});

describe('applyChange', () => {
  it('ties two first for a line’s field, and takes someone’s lines with them', () => {
    const setup = setupOf(page());
    const tied = applyChange(setup, { kind: 'field', field: { kind: 'side', id: IVEN, other: NOBODY, field: 'sees' }, text: 'A debtor.' });
    expect(tied?.relationships).toHaveLength(2);
    const without = applyChange(setup, { kind: 'remove', id: IVEN });
    expect(without?.cast.map((person) => person.id)).toEqual([NOBODY]);
    expect(without?.relationships).toEqual([]);
  });

  it('is null for a change that doesn’t fit', () => {
    const setup = setupOf(page());
    expect(applyChange(setup, { kind: 'remove', id: MARA })).toBeNull();
    expect(applyChange(setup, { kind: 'untie', a: IVEN, b: NOBODY })).toBeNull();
    expect(applyChange(setup, { kind: 'field', field: { kind: 'bond', a: IVEN, b: ANOTHER }, text: 'x' })).toBeNull();
    const twice = { id: IVEN, name: 'Iven again', who: '', personality: '', past: '', notes: '' };
    expect(applyChange(setup, { kind: 'add', person: twice })).toBeNull();
  });
});

describe('alone', () => {
  it('runs one exchange at a time in a chat', async () => {
    const chatId = crypto.randomUUID();
    let release = () => {};
    const held = alone(chatId, () => {
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    await expect(alone(chatId, async () => 1)).rejects.toThrow(ChatError);
    await expect(alone(crypto.randomUUID(), async () => 2)).resolves.toBe(2);
    release();
    await held;
    await expect(alone(chatId, async () => 3)).resolves.toBe(3);
  });
});

const proxies: FakeProxy[] = [];

afterEach(async () => {
  for (const proxy of proxies.splice(0)) {
    await proxy.close();
  }
});

/** A fake proxy whose models answer with these replies. */
async function proxyWith(replies: Reply[]) {
  const proxy = await fakeProxy({ ...antigravity(), replies });
  proxies.push(proxy);
  return proxy;
}

/** A writer that can write, with its models from this catalog, its login and its account's id. */
async function setUp(catalog: Catalog | null) {
  const email = address('chat');
  const app = writer({ WRITER_EMAILS: [email] }, catalog);
  const cookie = await account(email, true);
  const [user] = await deps.breader.select().from(users).where(eq(users.email, email));
  return { app, cookie, userId: user.id };
}

async function aBook(userId: string): Promise<string> {
  const [book] = await deps.db
    .insert(books)
    .values({ userId, title: 'The Salt Queen', color: 'teal', length: 'novella', wordGoal: 30000, pov: 'third_close', darkness: 'mature' })
    .returning();
  return book.id;
}

/** The events of a stream, in order. */
function eventsOf(text: string): ChatEvent[] {
  const events: ChatEvent[] = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      const data = JSON.parse(line.slice('data: '.length));
      events.push(ChatEvent.parse(data));
    }
  }
  return events;
}

/** The owner says something in the chat: the stream's events, or the error it answered with instead. */
async function say(app: Writer, cookie: string, body: Record<string, unknown>) {
  const headers: Record<string, string> = { origin: ORIGIN, 'content-type': 'application/json' };
  if (cookie) {
    headers.cookie = cookie;
  }
  const ask = { chatId: null, bookId: null, setup: page(), ...body };
  const res = await app.request('/v1/suggestions/chats', { method: 'POST', headers, body: JSON.stringify(ask) });
  const text = await res.text();
  const type = res.headers.get('content-type') ?? '';
  if (!type.startsWith('text/event-stream')) {
    return { status: res.status, events: [], body: JSON.parse(text) };
  }
  return { status: res.status, events: eventsOf(text), body: null };
}

/** The chat a stream ended with. */
function chatOf(events: ChatEvent[]): Chat {
  const last = events.at(-1);
  if (!last || last.type !== 'done') {
    throw new Error(`the stream ended with ${JSON.stringify(last)}`);
  }
  return last.chat;
}

/** The words Procreator streamed. */
function streamedText(events: ChatEvent[]): string {
  let text = '';
  for (const event of events) {
    if (event.type === 'text') {
      text += event.delta;
    }
  }
  return text;
}

/** A model reply that lists these changes, with a note for the owner, and maybe words of its own. */
function proposing(changes: ChangeArgs[], note: string, text?: string): Reply {
  return { text, calls: [{ name: 'propose_changes', args: { note, changes } }] };
}

/** The entry holding the chat's latest list. */
function listEntry(chat: Chat) {
  const entry = chat.entries.findLast((each) => each.list !== null);
  if (!entry || !entry.list) {
    throw new Error('the chat has no list');
  }
  return { id: entry.id, list: entry.list };
}

async function callsOf(userId: string) {
  return deps.db.select().from(calls).where(eq(calls.userId, userId)).orderBy(desc(calls.startedAt));
}

describe('POST /v1/suggestions/chats', () => {
  it('is closed without a login, and says the AI is offline without a proxy', async () => {
    const proxy = await proxyWith([{ text: 'Hello.' }]);
    const r = await say(writer({}, catalogOf(proxy)), '', { text: 'Hi' });
    expect(r.status).toBe(401);
    const none = await setUp(null);
    const off = await say(none.app, none.cookie, { text: 'Hi' });
    expect(off.status).toBe(503);
    expect(off.body.code).toBe('ai_offline');
  });

  it('streams Procreator’s words, then the chat with its list open', async () => {
    const changes: ChangeArgs[] = [
      { kind: 'set', field: 'tone', text: 'Wry and salt-stung' },
      { kind: 'set', field: 'past', person: 'Mara', text: 'Lost her mother to the tide.' },
    ];
    const proxy = await proxyWith([proposing(changes, 'Wry, with a past to match.', 'A wry tone suits a ferry story.')]);
    const { app, cookie, userId } = await setUp(catalogOf(proxy));
    const bookId = await aBook(userId);
    const r = await say(app, cookie, { bookId, text: 'Make it funnier' });
    expect(r.status).toBe(200);

    const [started] = r.events;
    expect(started.type).toBe('started');
    // Its words, then the list's note.
    expect(streamedText(r.events)).toBe('A wry tone suits a ferry story.\n\nWry, with a past to match.');
    const chat = chatOf(r.events);
    if (started.type === 'started') {
      expect(started.chatId).toBe(chat.id);
    }
    expect(chat.entries).toMatchObject([
      { by: 'owner', text: 'Make it funnier', list: null },
      {
        by: 'procreator',
        text: 'A wry tone suits a ferry story.\n\nWry, with a past to match.',
        list: {
          state: 'open',
          items: [
            { kind: 'field', field: { kind: 'world', field: 'tone' }, text: 'Wry and salt-stung' },
            { kind: 'field', field: { kind: 'character', id: MARA, field: 'past' }, text: 'Lost her mother to the tide.' },
          ],
        },
      },
    ]);

    // The list ends the exchange: one call, with the page first and the owner's words last.
    expect(proxy.asked).toHaveLength(1);
    const [asked] = proxy.asked;
    const { system, user } = promptOf(asked);
    expect(system.startsWith('You are Procreator.')).toBe(true);
    expect(toolsOf(asked)).toEqual(['propose_changes', 'revise_change']);
    expect(user.startsWith('<page>\n<book>\nTitle: The Salt Queen')).toBe(true);
    expect(user).toContain('<person ref="Unnamed 1">');
    expect(user.endsWith('<owner>\nMake it funnier\n</owner>')).toBe(true);
    // The owner's story is being shaped, so it thinks as the account picked.
    expect(asked.body.generationConfig?.thinkingConfig?.thinkingLevel).toBe('HIGH');

    const [recorded] = await callsOf(userId);
    expect(recorded).toMatchObject({ role: 'setup', bookId, sceneId: null, thinking: 'high' });

    const kept = await call(app, 'GET', `/v1/suggestions/chats?book=${bookId}`, cookie);
    expect(kept.body).toEqual({ chat });
    const byId = await call(app, 'GET', `/v1/suggestions/chats/${chat.id}`, cookie);
    expect(byId.body).toEqual(chat);
  });

  it('goes on in the book’s chat, sets an open list aside, and sends the page only once it changed', async () => {
    const proxy = await proxyWith([
      proposing([{ kind: 'set', field: 'tone', text: 'Wry' }], 'Wry, then.', 'Wry it is.'),
      { text: 'Bleak could work too.' },
      { text: 'A smuggler fits.' },
    ]);
    const { app, cookie, userId } = await setUp(catalogOf(proxy));
    const bookId = await aBook(userId);
    const first = chatOf((await say(app, cookie, { bookId, text: 'Make it funnier' })).events);
    // Without its id, the book's chat is found by the book.
    const second = chatOf((await say(app, cookie, { bookId, text: 'Actually, bleaker?' })).events);
    expect(second.id).toBe(first.id);
    expect(second.entries.map((entry) => entry.list?.state ?? null)).toEqual([null, 'set_aside', null, null]);

    // The second call starts as the first did, so the cache holds, and doesn't send the page again.
    const [one, two] = proxy.asked;
    expect(two.body.contents[0]).toEqual(one.body.contents[0]);
    expect(textsOf(two)).toContain('Wry it is.');
    expect(promptOf(two).user).toBe('<owner>\nActually, bleaker?\n</owner>');

    const changed = { ...page(), title: 'Brine' };
    await say(app, cookie, { chatId: first.id, setup: changed, text: 'Who is Unnamed 1?' });
    const three = promptOf(proxy.asked[2]).user;
    expect(three.startsWith('<page>\n<book>\nTitle: Brine')).toBe(true);
    expect(three.endsWith('<owner>\nWho is Unnamed 1?\n</owner>')).toBe(true);
  });

  it('starts a new book’s chat each time it isn’t given one', async () => {
    const proxy = await proxyWith([{ text: 'Hello.' }]);
    const { app, cookie } = await setUp(catalogOf(proxy));
    const one = chatOf((await say(app, cookie, { text: 'Hi' })).events);
    const two = chatOf((await say(app, cookie, { text: 'Hi' })).events);
    expect(two.id).not.toBe(one.id);
    const again = chatOf((await say(app, cookie, { chatId: one.id, text: 'Hi again' })).events);
    expect(again.id).toBe(one.id);
    expect(again.entries).toHaveLength(4);
  });

  it('sends a list that doesn’t fit back to Procreator, item by item, until it does', async () => {
    const proxy = await proxyWith([
      proposing(
        [
          { kind: 'set', field: 'past', person: 'Nobody', text: 'x' },
          { kind: 'remove', person: 'Mara' },
        ],
        'Here it is.',
        'Let me list it.',
      ),
      proposing([{ kind: 'set', field: 'past', person: 'Iven', text: 'He sailed with pirates.' }], 'Fixed.', 'Sorry, again.'),
    ]);
    const { app, cookie, userId } = await setUp(catalogOf(proxy));
    const r = await say(app, cookie, { text: 'Give Iven a past' });
    expect(proxy.asked).toHaveLength(2);
    const told = proxy.asked[1].body.contents.at(-1)?.parts[0].functionResponse?.response;
    expect(told?.error).toBe(
      [
        'Item 1: no one on the page is called Nobody. Use a name as the page gives it, or add them earlier in the list.',
        'Item 2: Mara is the one the owner plays, and stays.',
        'Nothing was shown to the owner. Put those right and call propose_changes again, with the whole list.',
      ].join('\n'),
    );
    // Its words from both replies, a blank line between them, and only the note of the list shown.
    expect(streamedText(r.events)).toBe('Let me list it.\n\nSorry, again.\n\nFixed.');
    const chat = chatOf(r.events);
    expect(chat.entries[1]).toMatchObject({ text: 'Let me list it.\n\nSorry, again.\n\nFixed.' });
    expect(listEntry(chat).list.items).toEqual([
      { kind: 'field', field: { kind: 'character', id: IVEN, field: 'past' }, text: 'He sailed with pirates.' },
    ]);
    expect(await callsOf(userId)).toHaveLength(2);
  });

  it('turns away a redo when nothing is being redone', async () => {
    const proxy = await proxyWith([
      { calls: [{ name: 'revise_change', args: { change: { kind: 'set', field: 'tone', text: 'Wry' } } }] },
      { text: 'No list yet.' },
    ]);
    const { app, cookie } = await setUp(catalogOf(proxy));
    const chat = chatOf((await say(app, cookie, { text: 'Hmm' })).events);
    const told = proxy.asked[1].body.contents.at(-1)?.parts[0].functionResponse?.response;
    expect(told?.error).toBe("There's no item to redo. To change your list, make a new one with propose_changes.");
    expect(chat.entries[1]).toMatchObject({ text: 'No list yet.', list: null });
  });

  it('keeps what the owner said when the model doesn’t answer', async () => {
    const proxy = await proxyWith([{ status: 400 }, { text: 'Back now.' }]);
    const { app, cookie } = await setUp(catalogOf(proxy));
    const r = await say(app, cookie, { text: 'Anyone there?' });
    const last = r.events.at(-1);
    expect(last).toMatchObject({ type: 'error', code: 'ai_failed' });
    if (last?.type !== 'error' || !last.chat) {
      throw new Error('the stream should end with the chat as it was kept');
    }
    expect(last.chat.entries).toMatchObject([{ by: 'owner', text: 'Anyone there?' }]);

    const again = chatOf((await say(app, cookie, { chatId: last.chat.id, text: 'Hello?' })).events);
    expect(again.entries.map((entry) => entry.by)).toEqual(['owner', 'owner', 'procreator']);
    // Both of the owner's words go, though the first got no answer.
    const texts = textsOf(proxy.asked[1]);
    expect(texts.some((text) => text.includes('Anyone there?'))).toBe(true);
    expect(texts.at(-1)).toBe('<owner>\nHello?\n</owner>');
  });

  it('keeps each account to its own chats', async () => {
    const proxy = await proxyWith([{ text: 'Hello.' }]);
    const mine = await setUp(catalogOf(proxy));
    const bookId = await aBook(mine.userId);
    const chat = chatOf((await say(mine.app, mine.cookie, { bookId, text: 'Hi' })).events);

    const other = await setUp(catalogOf(proxy));
    const theirs = await say(other.app, other.cookie, { chatId: chat.id, text: 'Hi' });
    expect(theirs.status).toBe(404);
    const read = await call(other.app, 'GET', `/v1/suggestions/chats/${chat.id}`, other.cookie);
    expect(read.status).toBe(404);
    const byBook = await call(other.app, 'GET', `/v1/suggestions/chats?book=${bookId}`, other.cookie);
    expect(byBook.body).toEqual({ chat: null });
    const nonsense = await call(mine.app, 'GET', '/v1/suggestions/chats/nonsense', mine.cookie);
    expect(nonsense.status).toBe(404);

    // Saying something with another account's book starts a chat of one's own, with no book.
    const fresh = chatOf((await say(other.app, other.cookie, { bookId, text: 'Hi' })).events);
    expect(fresh.id).not.toBe(chat.id);
    const still = await call(mine.app, 'GET', `/v1/suggestions/chats?book=${bookId}`, mine.cookie);
    expect(still.body.chat.id).toBe(chat.id);
  });
});

describe('the list, redone and approved', () => {
  const changes: ChangeArgs[] = [
    { kind: 'set', field: 'tone', text: 'Wry' },
    { kind: 'set', field: 'past', person: 'Iven', text: 'A fisherman.' },
  ];

  /** A chat with an open list of two. */
  async function withList(more: Reply[]) {
    const proxy = await proxyWith([proposing(changes, 'Two things.'), ...more]);
    const { app, cookie } = await setUp(catalogOf(proxy));
    const chat = chatOf((await say(app, cookie, { text: 'Help' })).events);
    return { proxy, app, cookie, chat, entry: listEntry(chat).id };
  }

  it('redoes one item in its place, as the owner’s notes say', async () => {
    const revised = { kind: 'set', field: 'past', person: 'Iven', text: 'He drowned a man.' };
    const { proxy, app, cookie, chat, entry } = await withList([{ calls: [{ name: 'revise_change', args: { change: revised } }] }]);
    const r = await send(app, 'POST', `/v1/suggestions/chats/${chat.id}/redo`, cookie, { entry, item: 1, notes: 'Darker', setup: page() });
    expect(r.status).toBe(200);
    expect(listEntry(r.body).list).toEqual({
      state: 'open',
      items: [
        { kind: 'field', field: { kind: 'world', field: 'tone' }, text: 'Wry' },
        { kind: 'field', field: { kind: 'character', id: IVEN, field: 'past' }, text: 'He drowned a man.' },
      ],
    });
    // Nothing else is said in the chat.
    expect(r.body.entries).toHaveLength(2);
    expect(promptOf(proxy.asked[1]).user).toBe(
      [
        "Redo item 2 of your list, and only that item, as the owner's notes on it say. The item as it stands:",
        '',
        '<item>',
        '{"kind":"set","field":"past","person":"Iven","text":"A fisherman."}',
        '</item>',
        '',
        '<notes>',
        'Darker',
        '</notes>',
        '',
        'Answer with revise_change: a change to the same thing, redone as the notes say.',
      ].join('\n'),
    );
  });

  it('says so when Procreator doesn’t redo it', async () => {
    const { proxy, app, cookie, chat, entry } = await withList([proposing(changes, 'Again.'), { text: 'Sure.' }]);
    const r = await send(app, 'POST', `/v1/suggestions/chats/${chat.id}/redo`, cookie, { entry, item: 0, notes: 'Funnier', setup: page() });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('chat_conflict');
    const told = proxy.asked[2].body.contents.at(-1)?.parts[0].functionResponse?.response;
    expect(told?.error).toBe('Redo only item 1, with revise_change.');
    const kept = await call(app, 'GET', `/v1/suggestions/chats/${chat.id}`, cookie);
    expect(listEntry(kept.body).list).toEqual(listEntry(chat).list);
  });

  it('turns away a redo of a list that isn’t open, or an item it hasn’t got', async () => {
    const { proxy, app, cookie, chat, entry } = await withList([]);
    const past = await send(app, 'POST', `/v1/suggestions/chats/${chat.id}/redo`, cookie, { entry, item: 2, notes: 'More', setup: page() });
    expect(past.status).toBe(409);
    const wrong = await send(app, 'POST', `/v1/suggestions/chats/${chat.id}/redo`, cookie, { entry: entry - 1, item: 0, notes: 'More', setup: page() });
    expect(wrong.status).toBe(409);
    expect(proxy.asked).toHaveLength(1);
  });

  it('approves the list once, and tells Procreator so with the owner’s next words', async () => {
    const { proxy, app, cookie, chat, entry } = await withList([{ text: 'Glad you like it.' }]);
    const r = await send(app, 'POST', `/v1/suggestions/chats/${chat.id}/approve`, cookie, { entry });
    expect(r.status).toBe(200);
    expect(listEntry(r.body).list.state).toBe('approved');
    const twice = await send(app, 'POST', `/v1/suggestions/chats/${chat.id}/approve`, cookie, { entry });
    expect(twice.status).toBe(409);

    const approved = { ...page(), world: { ...page().world, tone: 'Wry' } };
    const next = chatOf((await say(app, cookie, { chatId: chat.id, setup: approved, text: 'Thanks' })).events);
    expect(next.entries[1].list?.state).toBe('approved');
    const { user } = promptOf(proxy.asked[1]);
    expect(user).toContain('Tone: Wry');
    expect(user.endsWith("The owner approved your last list, and it's on the page now.\n\n<owner>\nThanks\n</owner>")).toBe(true);

    // Only once: the owner's next words after that don't say it again.
    await say(app, cookie, { chatId: chat.id, setup: approved, text: 'More?' });
    expect(promptOf(proxy.asked[2]).user).toBe('<owner>\nMore?\n</owner>');
  });

  it('keeps another account out of the list', async () => {
    const { chat, entry } = await withList([]);
    const email = address('chat');
    const cookie = await account(email, true);
    const theirs = writer({ WRITER_EMAILS: [email] }, null);
    const r = await send(theirs, 'POST', `/v1/suggestions/chats/${chat.id}/approve`, cookie, { entry });
    expect(r.status).toBe(404);
  });
});
