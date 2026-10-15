import { and, asc, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { PlayEvent, type Play } from '@writer/shared/play';
import type { Catalog } from '../src/ai/catalog.ts';
import { users } from '../src/db/breader.ts';
import { actorMessages, actorSegments, calls, changes, scenes, sessionMessages, turns } from '../src/db/schema.ts';
import { ORIGIN, account, address, call, deps, writer, type Writer } from './helpers.ts';
import { antigravity, catalogOf, fakeProxy, promptOf, textsOf, toolsOf, type Asked, type FakeProxy, type Reply } from './proxy.ts';
import { aBook } from './stories.ts';

const db = deps.db;
const proxies: FakeProxy[] = [];

afterEach(async () => {
  for (const proxy of proxies.splice(0)) {
    await proxy.close();
  }
});

/** A fake proxy whose models answer with these replies, in turn. */
async function proxyWith(replies: Reply[]) {
  const proxy = await fakeProxy({ ...antigravity(), replies });
  proxies.push(proxy);
  return proxy;
}

/** A writer that can write, with a book (Aiko, the protagonist, Ren and Sora), on this catalog. */
async function setUp(catalog: Catalog | null) {
  const email = address('play');
  const app = writer({ WRITER_EMAILS: [email] }, catalog);
  const cookie = await account(email, true);
  const [user] = await deps.breader.select().from(users).where(eq(users.email, email));
  const book = await aBook(user.id);
  return { app, cookie, ...book };
}

/** A play route's answer: the stream's events, or its JSON. */
async function ask(app: Writer, cookie: string, bookId: string, path: string, body: unknown = {}) {
  const headers: Record<string, string> = { origin: ORIGIN, 'content-type': 'application/json', cookie };
  const res = await app.request(`/v1/books/${bookId}/play/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  const type = res.headers.get('content-type') ?? '';
  if (!type.startsWith('text/event-stream')) {
    return { status: res.status, events: [] as PlayEvent[], body: JSON.parse(text) };
  }
  const events: PlayEvent[] = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      events.push(PlayEvent.parse(JSON.parse(line.slice('data: '.length))));
    }
  }
  return { status: res.status, events, body: null };
}

/** The play a stream ended with, or the test fails with what it ended with instead. */
function playOf(events: PlayEvent[]): Play {
  const last = events.at(-1);
  if (!last || last.type !== 'done') {
    throw new Error(`the stream ended with ${JSON.stringify(last)}`);
  }
  return last.play;
}

/** The words Procreator streamed. */
function streamedText(events: PlayEvent[]): string {
  let text = '';
  for (const event of events) {
    if (event.type === 'text') {
      text += event.delta;
    }
  }
  return text;
}

function offering(): Reply {
  const openings = [
    { opening: 'The night of the fire, Aiko wakes to bells.', where: 'The Lamp House', when: 'The night of the fire', who: ['Aiko'] },
    { opening: 'Ren pulls Aiko from the river\u2014again.', where: 'The ferry', when: 'Dawn', who: ['Aiko', 'Ren'] },
    { opening: 'A letter from Sora comes, years too late.', where: 'The post office', when: 'Spring', who: ['Sora'] },
  ];
  return { calls: [{ name: 'offer_openings', args: { openings } }] };
}

/** A book whose story has opened on the ferry, with the replies after that in line. */
async function opened(after: Reply[]) {
  const proxy = await proxyWith([offering(), { text: 'The river is cold.' }, ...after]);
  const book = await setUp(catalogOf(proxy));
  await ask(book.app, book.cookie, book.bookId, 'openings');
  playOf((await ask(book.app, book.cookie, book.bookId, 'open', { kind: 'pick', opening: 1 })).events);
  return { proxy, ...book };
}

async function turnsOf(bookId: string) {
  return db.select().from(turns).where(eq(turns.bookId, bookId)).orderBy(asc(turns.number));
}

describe('play', () => {
  it('offers three openings for the first scene, once, in its session', async () => {
    const proxy = await proxyWith([offering()]);
    const { app, cookie, bookId } = await setUp(catalogOf(proxy));
    const before = await call(app, 'GET', `/v1/books/${bookId}/play`, cookie);
    expect(before.body).toMatchObject({ stage: 'start', scene: null, turns: [], protagonist: { name: 'Aiko' } });

    const r = await ask(app, cookie, bookId, 'openings');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ stage: 'openings', scene: { number: 1, place: '', time: '' } });
    expect(r.body.openings).toEqual([
      { text: 'The night of the fire, Aiko wakes to bells.', place: 'The Lamp House', time: 'The night of the fire' },
      { text: 'Ren pulls Aiko from the river, again.', place: 'The ferry', time: 'Dawn' },
      { text: 'A letter from Sora comes, years too late.', place: 'The post office', time: 'Spring' },
    ]);

    const [asked] = proxy.asked;
    expect(promptOf(asked).system).toContain('<narration>');
    expect(toolsOf(asked)).toContain('offer_openings');
    const [head, openings] = textsOf(asked);
    // Everyone is in the scene until the owner picks how it opens.
    expect(head).toContain('Present: Aiko, Ren, Sora');
    expect(openings.startsWith('<openings>')).toBe(true);
    const [recorded] = await db.select().from(calls).where(eq(calls.bookId, bookId));
    expect(recorded.role).toBe('openings');

    // Asked again, they're the same, and the model isn't.
    const again = await ask(app, cookie, bookId, 'openings');
    expect(again.body.openings).toEqual(r.body.openings);
    expect(proxy.asked).toHaveLength(1);
  });

  it('opens the story with the opening picked, streamed, from the same start the openings were asked with', async () => {
    const proxy = await proxyWith([offering(), { text: 'The river is cold\u2014colder than she remembers.' }]);
    const { app, cookie, bookId, aiko, ren } = await setUp(catalogOf(proxy));
    await ask(app, cookie, bookId, 'openings');
    const r = await ask(app, cookie, bookId, 'open', { kind: 'pick', opening: 1 });

    expect(r.events[0]).toEqual({ type: 'scene', scene: { number: 1, place: 'The ferry', time: 'Dawn' } });
    expect(streamedText(r.events)).toBe('The river is cold, colder than she remembers.');
    const play = playOf(r.events);
    expect(play).toMatchObject({ stage: 'playing', scene: { number: 1, place: 'The ferry', time: 'Dawn' }, openings: null, next: null });
    expect(play.turns).toMatchObject([
      { voice: 'opening', input: 'Ren pulls Aiko from the river, again.', reply: 'The river is cold, colder than she remembers.', played: null },
    ]);

    const [first] = await db.select().from(scenes).where(eq(scenes.bookId, bookId));
    expect(first).toMatchObject({ status: 'playing', present: [aiko.id, ren.id] });
    const [openings, opening] = proxy.asked;
    // The brief is the same, so the cache holds it.
    expect(opening.body.contents[0]).toEqual(openings.body.contents[0]);
    const sent = textsOf(opening).at(-1) ?? '';
    expect(sent).toContain('<scene_opens number="1">');
    expect(sent).toContain("The owner's pick of how the story opens: Ren pulls Aiko from the river, again.");
    expect(sent).toContain('Where: The ferry');
    // The openings were an aside: never sent again.
    expect(textsOf(opening).some((text) => text.startsWith('<openings>'))).toBe(false);
  });

  it('opens with the owner’s own opening, which Procreator sets the scene for', async () => {
    const setting = { calls: [{ name: 'set_scene', args: { where: 'The bell tower', when: 'Midnight', who: ['Sora'] } }] };
    const proxy = await proxyWith([offering(), setting, { text: 'The bells ring.' }]);
    const { app, cookie, bookId, sora } = await setUp(catalogOf(proxy));
    await ask(app, cookie, bookId, 'openings');
    const r = await ask(app, cookie, bookId, 'open', { kind: 'own', text: 'Aiko climbs the bell tower at midnight.' });

    expect(r.events.filter((event) => event.type === 'scene')).toEqual([
      { type: 'scene', scene: { number: 1, place: '', time: '' } },
      { type: 'scene', scene: { number: 1, place: 'The bell tower', time: 'Midnight' } },
    ]);
    const play = playOf(r.events);
    expect(play.scene).toEqual({ number: 1, place: 'The bell tower', time: 'Midnight' });
    expect(play.turns).toMatchObject([{ voice: 'opening', input: 'Aiko climbs the bell tower at midnight.', reply: 'The bells ring.' }]);
    const [first] = await db.select().from(scenes).where(eq(scenes.bookId, bookId));
    expect(first.present).toEqual([sora.id]);
  });

  it('narrates a move or a note, and marks who joined and what shifted at it', async () => {
    const joining = {
      calls: [{ name: 'join_cast', args: { name: 'Corwin', who: 'A lantern seller', personality: 'Shrewd', past: '' } }],
    };
    const shifting = {
      calls: [{ name: 'shift_relationship', args: { between: ['Aiko', 'Ren'], what: '[[Aiko]] stops trusting [[Ren]]\u2014for now.' } }],
    };
    const { app, cookie, bookId, aiko } = await opened([joining, shifting, { text: 'Corwin sets the lantern down.' }, { text: 'Morning comes.' }]);

    const r = await ask(app, cookie, bookId, 'move', { voice: 'character', text: 'I ask who sold the rope.' });
    const play = playOf(r.events);
    expect(play.turns[1]).toMatchObject({
      voice: 'character',
      played: { id: aiko.id, name: 'Aiko' },
      input: 'I ask who sold the rope.',
      reply: 'Corwin sets the lantern down.',
      marks: [
        { kind: 'joined', name: 'Corwin' },
        { kind: 'shifted', between: 'Aiko and Ren', text: 'Aiko stops trusting Ren, for now.' },
      ],
    });
    const [first] = await db.select().from(scenes).where(eq(scenes.bookId, bookId));
    expect(first.present).toHaveLength(3);

    const note = await ask(app, cookie, bookId, 'move', { voice: 'author', text: 'Skip to the morning.' });
    expect(playOf(note.events).turns[2]).toMatchObject({ voice: 'author', played: null, input: 'Skip to the morning.', reply: 'Morning comes.' });
  });

  it('sends a move as the owner’s character, and an author note as one', async () => {
    const { app, cookie, bookId, proxy } = await opened([{ text: 'Ren laughs.' }, { text: 'Rain.' }]);
    await ask(app, cookie, bookId, 'move', { voice: 'character', text: 'I splash Ren.' });
    await ask(app, cookie, bookId, 'move', { voice: 'author', text: 'Make it rain.' });
    expect(textsOf(proxy.asked[2]).at(-1)).toBe('<move by="Aiko">I splash Ren.</move>');
    expect(textsOf(proxy.asked[3]).at(-1)).toBe('<author_note>Make it rain.</author_note>');
  });

  it('ends a scene, waits for the owner, and can take the move that ended it back', async () => {
    const ending = {
      text: 'The doors close behind them.',
      calls: [{ name: 'end_scene', args: { where: 'The north road', when: 'Two days later', who: ['Aiko', 'Ren'] } }],
    };
    const { app, cookie, bookId } = await opened([ending]);
    const r = await ask(app, cookie, bookId, 'move', { voice: 'character', text: 'I leave.' });
    const ended = playOf(r.events);
    expect(ended).toMatchObject({ stage: 'ended', scene: { number: 1 }, next: { number: 2, place: 'The north road', time: 'Two days later' } });
    expect(ended.turns.at(-1)?.reply).toBe('The doors close behind them.');

    const refused = await ask(app, cookie, bookId, 'move', { voice: 'character', text: 'I wait.' });
    expect(refused.events.at(-1)).toMatchObject({ type: 'error', code: 'play_conflict' });

    const undone = await ask(app, cookie, bookId, 'undo');
    expect(undone.status).toBe(200);
    expect(undone.body).toMatchObject({ voice: 'character', words: 'I leave.', play: { stage: 'playing', next: null } });
    expect(undone.body.play.turns).toHaveLength(1);
    const all = await db.select().from(scenes).where(eq(scenes.bookId, bookId));
    expect(all.map((scene) => [scene.number, scene.status])).toEqual([[1, 'playing']]);
  });

  it('goes on to the next scene: the one before is wrapped up, and the next one opens', async () => {
    const ending = {
      text: 'The doors close.',
      calls: [{ name: 'end_scene', args: { where: 'The north road', when: 'Two days later', who: ['Ren'] } }],
    };
    const { app, cookie, bookId, proxy } = await opened([ending, { text: 'Aiko and Ren crossed the river.' }, { text: 'Rain followed them.' }]);
    await ask(app, cookie, bookId, 'move', { voice: 'character', text: 'I leave.' });
    const r = await ask(app, cookie, bookId, 'next');

    expect(r.events.slice(0, 2)).toEqual([
      { type: 'scene', scene: { number: 2, place: 'The north road', time: 'Two days later' } },
      { type: 'finishing', scene: 1 },
    ]);
    expect(streamedText(r.events)).toBe('Rain followed them.');
    const play = playOf(r.events);
    expect(play).toMatchObject({ stage: 'playing', scene: { number: 2 }, turns: [{ voice: 'opening', input: '', reply: 'Rain followed them.' }] });

    const [first] = await db.select().from(scenes).where(and(eq(scenes.bookId, bookId), eq(scenes.number, 1)));
    expect(first.summary).toBe('Aiko and Ren crossed the river.');
    // The wrap-up went in the first scene's session; the opening opened the second's with a brief that has it.
    const opening = proxy.asked.at(-1);
    if (!opening) {
      throw new Error('no call opened the scene');
    }
    expect(textsOf(opening)[0]).toContain('Aiko and Ren crossed the river.');

    // An opening can be written again, not taken back.
    const refused = await ask(app, cookie, bookId, 'undo');
    expect(refused.status).toBe(409);
  });

  it('writes another reply to the newest turn, sending the session as if the first never happened', async () => {
    const { app, cookie, bookId, proxy } = await opened([{ text: 'Ren laughs.' }, { text: 'Ren frowns.' }]);
    await ask(app, cookie, bookId, 'move', { voice: 'character', text: 'I splash Ren.' });
    const r = await ask(app, cookie, bookId, 'again');
    const play = playOf(r.events);
    expect(play.turns.map((turn) => turn.reply)).toEqual(['The river is cold.', 'Ren frowns.']);
    expect(play.turns[1].input).toBe('I splash Ren.');

    const kept = await turnsOf(bookId);
    expect(kept.map((turn) => [turn.input, turn.undone])).toEqual([
      ['Ren pulls Aiko from the river, again.', false],
      ['I splash Ren.', true],
      ['I splash Ren.', false],
    ]);
    const last = proxy.asked.at(-1);
    if (!last) {
      throw new Error('no call wrote the reply again');
    }
    expect(textsOf(last).some((text) => text.includes('Ren laughs.'))).toBe(false);
  });

  it('says when the AI account has reached its limit, and when it resets', async () => {
    const limit = { status: 429, message: 'Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 90h20m44s.' };
    const { app, cookie, bookId } = await opened([limit]);
    const r = await ask(app, cookie, bookId, 'move', { voice: 'character', text: 'I wave.' });
    const last = r.events.at(-1);
    expect(last).toMatchObject({ type: 'error', code: 'ai_limit' });
    if (last?.type !== 'error') {
      throw new Error('the stream should end with an error');
    }
    expect(last.message).toBe('The AI account has reached its limit for this model, until it resets in about 90 hours. Pick another model at the top to go on meanwhile.');
    expect(last.play.turns).toHaveLength(1);
  });

  it('takes back a move Procreator couldn’t narrate, and what it changed at it', async () => {
    const joining = { calls: [{ name: 'join_cast', args: { name: 'Corwin', who: 'A lantern seller', personality: '', past: '' } }] };
    const { app, cookie, bookId } = await opened([joining, { status: 400 }]);
    const r = await ask(app, cookie, bookId, 'move', { voice: 'character', text: 'I wave.' });
    const last = r.events.at(-1);
    expect(last).toMatchObject({ type: 'error', code: 'ai_failed' });
    if (last?.type !== 'error') {
      throw new Error('the stream should end with an error');
    }
    expect(last.play.turns).toHaveLength(1);
    const kept = await turnsOf(bookId);
    expect(kept.at(-1)).toMatchObject({ input: 'I wave.', undone: true });
    const play = await call(app, 'GET', `/v1/books/${bookId}/play`, cookie);
    expect(play.body.stage).toBe('playing');
    const joined = await db.select().from(changes).where(and(eq(changes.bookId, bookId), eq(changes.what, 'Corwin joined the cast')));
    expect(joined[0].takenBackBy).not.toBeNull();
  });

  it('offers three moves as hints, saves nothing, and never sends them again', async () => {
    const writing = { calls: [{ name: 'remember', args: { note: 'The owner likes boats.' } }] };
    const moves = { calls: [{ name: 'offer_moves', args: { moves: ['I dive.', 'I wait\u2014and watch.', 'I call for Ren.'] } }] };
    const { app, cookie, bookId, proxy } = await opened([writing, moves, { text: 'Ren waves.' }]);
    const r = await ask(app, cookie, bookId, 'hints');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ moves: ['I dive.', 'I wait, and watch.', 'I call for Ren.'] });
    const told = proxy.asked[3].body.contents.at(-1)?.parts[0].functionResponse?.response;
    expect(told?.error).toBe('Nothing is saved while you offer moves. Call offer_moves instead.');

    const asides = await db.select().from(sessionMessages).where(and(eq(sessionMessages.bookId, bookId), eq(sessionMessages.kind, 'aside')));
    // The openings, and the hints with the refusal.
    expect(asides.length).toBeGreaterThan(2);
    await ask(app, cookie, bookId, 'move', { voice: 'character', text: 'I dive.' });
    const move = proxy.asked.at(-1);
    if (!move) {
      throw new Error('no call narrated the move');
    }
    expect(textsOf(move).some((text) => text.startsWith('<hints>'))).toBe(false);
  });

  it('keeps each account to its own books, and says when the AI is offline', async () => {
    const proxy = await proxyWith([offering()]);
    const mine = await setUp(catalogOf(proxy));
    const theirs = await setUp(catalogOf(proxy));
    const r = await call(mine.app, 'GET', `/v1/books/${theirs.bookId}/play`, mine.cookie);
    expect(r.status).toBe(404);
    const offline = await setUp(null);
    const off = await ask(offline.app, offline.cookie, offline.bookId, 'openings');
    expect(off.status).toBe(503);
    expect(off.body.code).toBe('ai_offline');
  });
});

/** The calls made in actors' chats: they declare no tools, where Procreator's always do. */
function actorCalls(proxy: FakeProxy): Asked[] {
  return proxy.asked.filter((asked) => toolsOf(asked).length === 0);
}

/** The call after this one. */
function callAfter(proxy: FakeProxy, asked: Asked): Asked {
  const next = proxy.asked[proxy.asked.indexOf(asked) + 1];
  if (!next) {
    throw new Error('no call came after it');
  }
  return next;
}

/** What the last tool told Procreator, as its next call sends it back. */
function toldIn(asked: Asked): Record<string, unknown> | undefined {
  return asked.body.contents.at(-1)?.parts[0].functionResponse?.response;
}

function lastText(asked: Asked | undefined): string {
  if (!asked) {
    throw new Error('no such call');
  }
  return textsOf(asked).at(-1) ?? '';
}

/** Someone's actor's chat as it's kept, in order. */
async function actorChatOf(bookId: string, characterId: string) {
  return db
    .select()
    .from(actorMessages)
    .where(and(eq(actorMessages.bookId, bookId), eq(actorMessages.characterId, characterId)))
    .orderBy(asc(actorMessages.seq));
}

function contentOf(message: unknown): string {
  return (message as { content: string }).content;
}

function cueing(who: string, sees: string): Reply {
  return { calls: [{ name: 'cue', args: { who, sees } }] };
}

describe('actors', () => {
  it('cues an actor with only their side of the story, and narrates from the answer', async () => {
    const saving = {
      calls: [
        { name: 'write_page', args: { title: 'Plan', kind: 'story', about: 'Where the story goes', body: '[[Ren]] betrays [[Aiko]] at the bridge.' } },
        { name: 'write_page', args: { title: 'Ren', kind: 'character', about: '', body: '[[Ren]] owes the ferry guild.' } },
        { name: 'write_page', args: { title: 'Aiko', kind: 'character', about: '', body: '[[Aiko]] fears the river.' } },
      ],
    };
    const answer = { text: 'I take the oars\u2014slowly. "Fine."' };
    const { app, cookie, bookId, ren, proxy } = await opened([saving, cueing('Ren', 'Aiko asks you to row\u2014now.'), answer, { text: 'Ren took the oars.' }]);
    const r = await ask(app, cookie, bookId, 'move', { voice: 'character', text: 'I ask Ren to row.' });
    const play = playOf(r.events);
    expect(play).toMatchObject({ stage: 'playing', cue: null });
    expect(play.turns[1]).toMatchObject({ voice: 'character', input: 'I ask Ren to row.', reply: 'Ren took the oars.' });

    const [acting] = actorCalls(proxy);
    expect(promptOf(acting).system).toContain('You are Ren\'s actor.');
    const [head, cue] = textsOf(acting);
    expect(head).toContain('<you name="Ren">');
    expect(head).toContain('Who: The ferryman’s son');
    expect(head).toContain('Ren owes the ferry guild.');
    expect(head).toContain('<tie with="Aiko">');
    expect(head).toContain('What you are to each other: old friends');
    expect(head).toContain('Setting: A river city, winter');
    // Never the plan, anyone else's sheet or page, or how Aiko sees Ren and what she hides from him.
    for (const hidden of ['betrays', 'fears the river', 'lamplighter', 'Stubborn', 'a brother', 'docks']) {
      expect(head).not.toContain(hidden);
    }
    expect(cue).toContain('<scene number="1" where="The ferry" when="Dawn"/>');
    expect(cue).toContain('Aiko asks you to row, now.');
    expect(cue).not.toContain('<you_now>');

    // Procreator is told the answer, without its dashes.
    expect(toldIn(callAfter(proxy, acting))).toEqual({ output: 'Ren’s actor answers:\n\nI take the oars, slowly. "Fine."' });
    const chat = await actorChatOf(bookId, ren.id);
    expect(chat.map((row) => [row.kind, row.turnId, row.undone])).toEqual([
      ['play', play.turns[1].id, false],
      ['play', play.turns[1].id, false],
    ]);
    const recorded = await db.select().from(calls).where(and(eq(calls.bookId, bookId), eq(calls.role, 'actor')));
    expect(recorded).toHaveLength(1);
  });

  it('tells an actor who they are now when that changed, and the scene only when it’s new to them', async () => {
    const growing = { calls: [{ name: 'edit_page', args: { title: 'Ren', find: '', replace: '[[Ren]] is afraid of deep water.' } }] };
    const { app, cookie, bookId, proxy } = await opened([
      cueing('Ren', 'Aiko asks you to row.'),
      { text: 'I row.' },
      { text: 'Ren rowed.' },
      growing,
      cueing('Ren', 'The boat rocks.'),
      { text: 'I grip the side.' },
      { text: 'Ren gripped the side.' },
      cueing('Ren', 'Aiko laughs.'),
      { text: 'I scowl.' },
      { text: 'Ren scowled.' },
    ]);
    await ask(app, cookie, bookId, 'move', { voice: 'character', text: 'I ask Ren to row.' });
    await ask(app, cookie, bookId, 'move', { voice: 'character', text: 'I rock the boat.' });
    await ask(app, cookie, bookId, 'move', { voice: 'character', text: 'I laugh.' });

    const [first, second, third] = actorCalls(proxy);
    expect(lastText(first)).toContain('<scene number="1"');
    expect(lastText(second)).toContain('<you_now>');
    expect(lastText(second)).toContain('Ren is afraid of deep water.');
    expect(lastText(second)).not.toContain('<scene');
    expect(lastText(third)).not.toContain('<you_now>');
    expect(lastText(third)).not.toContain('<scene');
    // Each call starts as the one before, so the cache holds.
    expect(second.body.systemInstruction).toEqual(first.body.systemInstruction);
    expect(second.body.contents.slice(0, first.body.contents.length)).toEqual(first.body.contents);
    expect(third.body.contents.slice(0, second.body.contents.length)).toEqual(second.body.contents);
  });

  it('cues only the cast, never the one the owner plays, and brings whoever it cues into the scene', async () => {
    const { app, cookie, bookId, sora, proxy } = await opened([
      cueing('Aiko', 'The river.'),
      cueing('Corwin', 'The river.'),
      cueing('[[Sora]]', 'Aiko is on the ferry.'),
      { text: 'I wave from the bank.' },
      { text: 'Sora waved from the bank.' },
    ]);
    const r = await ask(app, cookie, bookId, 'move', { voice: 'character', text: 'I look to the bank.' });
    expect(playOf(r.events).turns[1].reply).toBe('Sora waved from the bank.');
    expect(String(toldIn(proxy.asked[3])?.error)).toContain('Aiko is the owner');
    expect(String(toldIn(proxy.asked[4])?.error)).toContain('play passing extras yourself');
    const [first] = await db.select().from(scenes).where(eq(scenes.bookId, bookId));
    expect(first.present).toContain(sora.id);
  });

  it('sends an answer back with a note, only once the actor has answered this turn', async () => {
    const sending = { calls: [{ name: 'send_back', args: { who: 'Ren', note: 'He would never refuse her.' } }] };
    const { app, cookie, bookId, proxy } = await opened([
      sending,
      cueing('Ren', 'Aiko asks you to row.'),
      { text: 'No.' },
      sending,
      { text: 'Fine. I row.' },
      { text: 'Ren rowed.' },
    ]);
    const r = await ask(app, cookie, bookId, 'move', { voice: 'character', text: 'I ask Ren to row.' });
    expect(playOf(r.events).turns[1].reply).toBe('Ren rowed.');
    expect(String(toldIn(proxy.asked[3])?.error)).toContain('hasn’t answered a cue this turn');

    const [answered, again] = actorCalls(proxy);
    expect(lastText(again).startsWith('<director>')).toBe(true);
    expect(lastText(again)).toContain('He would never refuse her.');
    expect(again.body.contents.slice(0, answered.body.contents.length)).toEqual(answered.body.contents);
    expect(toldIn(callAfter(proxy, again))).toEqual({ output: 'Ren’s actor answers again:\n\nFine. I row.' });
  });

  it('takes an actor’s chat back with the turn, and starts it afresh at the next cue', async () => {
    const { app, cookie, bookId, ren, proxy } = await opened([
      cueing('Ren', 'Aiko asks you to row.'),
      { text: 'I row.' },
      { text: 'Ren rowed.' },
      cueing('Ren', 'Aiko waves.'),
      { text: 'I wave back.' },
      { text: 'Ren waved back.' },
    ]);
    await ask(app, cookie, bookId, 'move', { voice: 'character', text: 'I ask Ren to row.' });
    await ask(app, cookie, bookId, 'undo');
    const cut = await actorChatOf(bookId, ren.id);
    expect(cut.map((row) => row.undone)).toEqual([true, true]);
    const segments = await db.select().from(actorSegments).where(eq(actorSegments.bookId, bookId));
    expect(segments.map((segment) => segment.undone)).toEqual([true]);

    await ask(app, cookie, bookId, 'move', { voice: 'character', text: 'I wave.' });
    const [, fresh] = actorCalls(proxy);
    expect(textsOf(fresh).some((text) => text.includes('I row.'))).toBe(false);
    expect(textsOf(fresh)).toHaveLength(2);
  });

  it('offers hints for the one about to act, while the owner says who plays them', async () => {
    const moves = { calls: [{ name: 'offer_moves', args: { moves: ['I row harder.', 'I drop the oars.', 'I laugh.'] } }] };
    const { app, cookie, bookId, proxy } = await opened([
      { text: 'Ren looks up.', calls: [{ name: 'cue', args: { who: 'Ren', sees: 'Aiko splashes you.' } }] },
      moves,
    ]);
    await ask(app, cookie, bookId, 'move', { voice: 'character', text: 'I splash Ren.', playOthers: true });
    const r = await ask(app, cookie, bookId, 'hints');
    expect(r.body).toEqual({ moves: ['I row harder.', 'I drop the oars.', 'I laugh.'] });
    expect(lastText(proxy.asked.at(-1))).toContain("The owner asks for help with Ren's next move.");
  });

  it('with the switch off, stops for the owner to play the one about to act, or let their actor', async () => {
    const { app, cookie, bookId, ren, proxy } = await opened([
      { text: 'Ren looks up from the oars.', calls: [{ name: 'cue', args: { who: 'Ren', sees: 'Aiko splashes you.' } }] },
      { text: 'The boat drifts.' },
      { text: 'Ren turns.', calls: [{ name: 'cue', args: { who: 'Ren', sees: 'Aiko follows you.' } }] },
      { text: 'I splash her back\u2014hard.' },
      { text: 'Ren splashed her back.' },
      { text: 'I duck.' },
      { text: 'Ren ducked.' },
    ]);
    const early = await ask(app, cookie, bookId, 'move', { voice: 'character', text: 'I row.', as: ren.id, playOthers: true });
    expect(early.events.at(-1)).toMatchObject({ type: 'error', code: 'play_conflict' });

    const r = await ask(app, cookie, bookId, 'move', { voice: 'character', text: 'I splash Ren.', playOthers: true });
    const stopped = playOf(r.events);
    expect(stopped).toMatchObject({ stage: 'cue', cue: { id: ren.id, name: 'Ren' } });
    expect(stopped.turns[1].reply).toBe('Ren looks up from the oars.');
    expect(actorCalls(proxy)).toHaveLength(0);

    // Only Ren can act now.
    const asAiko = await ask(app, cookie, bookId, 'move', { voice: 'character', text: 'I wait.', playOthers: true });
    expect(asAiko.events.at(-1)).toMatchObject({ type: 'error', code: 'play_conflict' });
    const note = await ask(app, cookie, bookId, 'move', { voice: 'author', text: 'Make it rain.', playOthers: true });
    expect(note.events.at(-1)).toMatchObject({ type: 'error', code: 'play_conflict' });

    // The owner plays Ren: Procreator is sent it as his move, and his actor is told it as his own, with nothing asked.
    const played = await ask(app, cookie, bookId, 'move', { voice: 'character', text: 'I row away.', as: ren.id, playOthers: true });
    const going = playOf(played.events);
    expect(going).toMatchObject({ stage: 'playing', cue: null });
    expect(going.turns[2]).toMatchObject({ voice: 'character', played: { id: ren.id, name: 'Ren' }, input: 'I row away.', reply: 'The boat drifts.' });
    expect(lastText(proxy.asked.at(-1))).toBe('<move by="Ren">I row away.</move>');
    expect(actorCalls(proxy)).toHaveLength(0);
    const told = await actorChatOf(bookId, ren.id);
    expect(told).toHaveLength(1);
    expect(contentOf(told[0].message)).toContain('Aiko splashes you.');
    expect(contentOf(told[0].message)).toContain('<played>\nI row away.\n</played>');

    // This time his actor plays him.
    await ask(app, cookie, bookId, 'move', { voice: 'character', text: 'I follow.', playOthers: true });
    const acted = await ask(app, cookie, bookId, 'actor', { playOthers: true });
    const after = playOf(acted.events);
    expect(after.turns[4]).toMatchObject({
      voice: 'actor',
      played: { id: ren.id, name: 'Ren' },
      input: 'I splash her back, hard.',
      reply: 'Ren splashed her back.',
    });
    const [acting] = actorCalls(proxy);
    expect(textsOf(acting).some((text) => text.includes('I row away.'))).toBe(true);
    expect(lastText(acting)).toContain('Aiko follows you.');
    expect(lastText(proxy.asked.at(-1))).toBe('<actor name="Ren">I splash her back, hard.</actor>');

    // Another reply has the actor play the moment afresh.
    const again = await ask(app, cookie, bookId, 'again', { playOthers: true });
    expect(playOf(again.events).turns[4]).toMatchObject({ voice: 'actor', input: 'I duck.', reply: 'Ren ducked.' });
    const [, afresh] = actorCalls(proxy);
    expect(textsOf(afresh).some((text) => text.includes('I splash her back'))).toBe(false);

    // Undo takes the actor's turn back and asks again, with no words for the box.
    const undone = await ask(app, cookie, bookId, 'undo');
    expect(undone.body).toMatchObject({ voice: 'actor', words: '', play: { stage: 'cue', cue: { id: ren.id } } });
    const standing = (await actorChatOf(bookId, ren.id)).filter((row) => !row.undone);
    expect(standing).toHaveLength(1);
  });
});
