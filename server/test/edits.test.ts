import { and, asc, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import type { Character, Relationship } from '@writer/shared/book';
import { EditEvent, type StoryEdit } from '@writer/shared/story';
import { users } from '../src/db/breader.ts';
import {
  actorMessages,
  actorSegments,
  books,
  calls,
  changes,
  characters,
  relationshipHistory,
  relationships,
  scenes,
  sessionMessages,
  sessionSegments,
  turns,
  worlds,
} from '../src/db/schema.ts';
import { REWROTE } from '../src/breading_ground.ts';
import { startChange } from '../src/story/changes.ts';
import { mention } from '../src/story/mentions.ts';
import { shiftRelationship } from '../src/story/relationships.ts';
import { ORIGIN, account, address, call, deps, send, writer, type Writer } from './helpers.ts';
import { antigravity, catalogOf, fakeProxy, promptOf, textsOf, toolsOf, type Asked, type FakeProxy, type Reply } from './proxy.ts';
import { aBook, sheet, tag } from './stories.ts';

/*
 * The owner's changes mid story, from the Story panel (step 6): what the panel shows, and changes
 * that hold from now on, told to Procreator as a note in the scene's session.
 */

const db = deps.db;
const proxies: FakeProxy[] = [];

afterEach(async () => {
  for (const proxy of proxies.splice(0)) {
    await proxy.close();
  }
});

function offering(): Reply {
  const openings = [
    { opening: 'The night of the fire, Aiko wakes to bells.', where: 'The Lamp House', when: 'The night of the fire', who: ['Aiko'] },
    { opening: 'Ren pulls Aiko from the river.', where: 'The ferry', when: 'Dawn', who: ['Aiko', 'Ren'] },
    { opening: 'A letter from Sora comes, years too late.', where: 'The post office', when: 'Spring', who: ['Aiko', 'Sora'] },
  ];
  return { calls: [{ name: 'offer_openings', args: { openings } }] };
}

/** A writer with a book (Aiko, the protagonist, Ren and Sora) whose first scene has its openings, and the replies after them in line. */
async function offered(after: Reply[]) {
  const proxy = await fakeProxy({ ...antigravity(), replies: [offering(), ...after] });
  proxies.push(proxy);
  const email = address('edits');
  const app = writer({ WRITER_EMAILS: [email] }, catalogOf(proxy));
  const cookie = await account(email, true);
  const [user] = await deps.breader.select().from(users).where(eq(users.email, email));
  const book = await aBook(user.id);
  await play(app, cookie, book.bookId, 'openings');
  return { proxy, app, cookie, email, ...book };
}

/** A book whose story has opened on the ferry with Aiko and Ren, and the replies after that in line. */
async function opened(after: Reply[]) {
  const book = await offered([{ text: 'The river is cold.' }, ...after]);
  await play(book.app, book.cookie, book.bookId, 'open', { kind: 'pick', opening: 1 });
  return book;
}

/** A play route, its answer read whole. */
async function play(app: Writer, cookie: string, bookId: string, path: string, body: unknown = {}) {
  const headers: Record<string, string> = { origin: ORIGIN, 'content-type': 'application/json', cookie };
  const res = await app.request(`/v1/books/${bookId}/play/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, text: await res.text() };
}

/** The statuses the JSON routes give for what an edit's stream ends with instead. */
const STATUS_OF: Record<string, number> = { story_conflict: 409, ai_failed: 502 };

/**
 * The owner's change, its stream read whole: the events, and how it ended as the JSON routes
 * answer, the story (or why not) as the body. One turned away before it streams is plain JSON.
 */
async function change(app: Writer, cookie: string, bookId: string, edit: StoryEdit, reach: 'now' | 'always' = 'now') {
  const headers: Record<string, string> = { origin: ORIGIN, 'content-type': 'application/json', cookie };
  const res = await app.request(`/v1/books/${bookId}/story/edits`, { method: 'POST', headers, body: JSON.stringify({ edit, reach }) });
  const text = await res.text();
  const type = res.headers.get('content-type') ?? '';
  if (!type.startsWith('text/event-stream')) {
    return { status: res.status, body: JSON.parse(text), events: [] as EditEvent[], rewrote: null };
  }
  const events: EditEvent[] = [];
  let body = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      body = JSON.parse(line.slice('data: '.length));
      events.push(EditEvent.parse(body));
    }
  }
  const last = events.at(-1);
  if (last?.type === 'done') {
    return { status: 200, body: body.story, events, rewrote: last.rewrote };
  }
  if (last?.type === 'error') {
    return { status: STATUS_OF[last.code] ?? 500, body, events, rewrote: null };
  }
  throw new Error('The edit’s stream ended without an answer');
}

/** The notes in a book's sessions: what Procreator is told of the owner's changes. */
async function notesIn(bookId: string) {
  return db
    .select()
    .from(sessionMessages)
    .where(and(eq(sessionMessages.bookId, bookId), eq(sessionMessages.kind, 'note')))
    .orderBy(asc(sessionMessages.seq));
}

function noteText(note: { message: unknown }): string {
  return (note.message as { content: string }).content;
}

/** The text of the last call Procreator was sent. */
function lastSent(proxy: FakeProxy): string[] {
  const last = proxy.asked.at(-1);
  if (!last) {
    throw new Error('Procreator was sent nothing');
  }
  return textsOf(last);
}

async function changeWhat(bookId: string, what: string) {
  const [found] = await db.select().from(changes).where(and(eq(changes.bookId, bookId), eq(changes.what, what)));
  return found;
}

async function newestTurnId(bookId: string): Promise<string> {
  const all = await db.select().from(turns).where(and(eq(turns.bookId, bookId), eq(turns.undone, false))).orderBy(asc(turns.number));
  const newest = all.at(-1);
  if (!newest) {
    throw new Error('nothing was played');
  }
  return newest.id;
}

async function personOf(bookId: string, id: string) {
  const [person] = await db.select().from(characters).where(and(eq(characters.bookId, bookId), eq(characters.id, id)));
  return person;
}

function line(one: Character, other: Character, bond: string): Relationship {
  return { bond, a: { id: one.id, sees: '', hides: '' }, b: { id: other.id, sees: '', hides: '' } };
}

/** Procreator's rewrite of a part of the story, by passage. */
function rewriting(edits: { passage: number; find?: string; every?: boolean; text: string }[]): Reply {
  return { calls: [{ name: 'rewrite_passages', args: { edits } }] };
}

/** The calls that asked Procreator to rewrite a part of the story, in order. */
function rewriteCalls(proxy: FakeProxy): Asked[] {
  return proxy.asked.filter((asked) => toolsOf(asked).includes('rewrite_passages'));
}

/** The turns that still stand, in order. */
async function standingTurns(bookId: string) {
  return db.select().from(turns).where(and(eq(turns.bookId, bookId), eq(turns.undone, false))).orderBy(asc(turns.number));
}

async function changesWhat(bookId: string, what: string) {
  return db.select().from(changes).where(and(eq(changes.bookId, bookId), eq(changes.what, what))).orderBy(asc(changes.id));
}

/** Every name in a set of texts, as whole words. */
function naming(texts: string[], name: string): boolean {
  const pattern = new RegExp(`\\b${name}\\b`);
  return texts.some((text) => pattern.test(text));
}

describe('the Story panel', () => {
  it('shows the story as it stands, with Procreator’s page about each person, and whether anything is played', async () => {
    const { app, cookie, bookId, ren } = await opened([]);
    const r = await call(app, 'GET', `/v1/books/${bookId}/story`, cookie);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ played: true, pages: {}, setup: { title: 'The Lantern Road', protagonist: { name: 'Aiko' } } });
    expect(r.body.setup.cast.map((person: Character) => person.name)).toEqual(['Ren', 'Sora']);
    expect(r.body.setup.relationships).toHaveLength(2);

    const fresh = await offered([]);
    const before = await call(fresh.app, 'GET', `/v1/books/${fresh.bookId}/story`, fresh.cookie);
    expect(before.body.played).toBe(false);

    const theirs = await call(fresh.app, 'GET', `/v1/books/${bookId}/story`, fresh.cookie);
    expect(theirs.status).toBe(404);
    const edit = await change(fresh.app, fresh.cookie, bookId, { kind: 'leave', id: ren.id });
    expect(edit.status).toBe(404);
  });

  it('turns setup’s own page away once the story has started', async () => {
    const { app, cookie, bookId } = await opened([]);
    const setup = await call(app, 'GET', `/v1/books/${bookId}/setup`, cookie);
    const r = await send(app, 'PUT', `/v1/books/${bookId}/setup`, cookie, { ...setup.body, title: 'Another' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('story_started');
  });
});

describe('a change from now on', () => {
  it('is the owner’s, at the newest turn, and Procreator reads it as a note with the next move', async () => {
    const { app, cookie, bookId, ren, proxy } = await opened([{ text: 'Ren keeps to the lamp.' }]);
    const r = await change(app, cookie, bookId, { kind: 'sheet', character: { ...ren, personality: 'Afraid of the dark' } });
    expect(r.status).toBe(200);
    expect(r.body.setup.cast[0]).toMatchObject({ name: 'Ren', personality: 'Afraid of the dark' });

    const made = await changeWhat(bookId, 'Changed Ren’s sheet');
    expect(made).toMatchObject({ by: 'owner', why: 'from now on', turnId: await newestTurnId(bookId) });
    const [note] = await notesIn(bookId);
    // Made at no turn, so an undo never cuts it.
    expect(note.turnId).toBeNull();
    const told = noteText(note);
    expect(told).toContain('<owner_change>');
    expect(told).toContain('<changed subject="Ren’s sheet">');
    expect(told).toContain('<field name="Personality">\n<was>Nothing.</was>\n<now>Afraid of the dark</now>');

    await play(app, cookie, bookId, 'move', { voice: 'character', text: 'I light a lamp.' });
    const sent = lastSent(proxy);
    expect(sent.at(-2)).toBe(told);
    expect(sent.at(-1)).toBe('<move by="Aiko">I light a lamp.</move>');
  });

  it('stays, with its note, when the move after it is taken back', async () => {
    const { app, cookie, bookId, ren, proxy } = await opened([{ text: 'Ren laughs.' }, { text: 'Ren hums.' }]);
    await change(app, cookie, bookId, { kind: 'sheet', character: { ...ren, past: 'Lost his father to the river' } });
    await play(app, cookie, bookId, 'move', { voice: 'character', text: 'I splash Ren.' });
    const undone = await play(app, cookie, bookId, 'undo');
    expect(undone.status).toBe(200);

    expect((await personOf(bookId, ren.id)).past).toBe('Lost his father to the river');
    const made = await changeWhat(bookId, 'Changed Ren’s sheet');
    expect(made.takenBackBy).toBeNull();
    const notes = await notesIn(bookId);
    expect(notes.map((note) => note.undone)).toEqual([false]);

    await play(app, cookie, bookId, 'move', { voice: 'character', text: 'I wave.' });
    expect(lastSent(proxy).some((text) => text.includes('Lost his father to the river'))).toBe(true);
  });

  it('changes nothing, and tells nothing, when nothing changed', async () => {
    const { app, cookie, bookId, ren } = await opened([]);
    const r = await change(app, cookie, bookId, { kind: 'sheet', character: ren });
    expect(r.status).toBe(200);
    expect(await notesIn(bookId)).toEqual([]);
    expect(await changeWhat(bookId, 'Changed Ren’s sheet')).toBeUndefined();
  });

  it('takes someone out of the cast and the scene, keeping their sheet, their lines and their history', async () => {
    const { app, cookie, bookId, aiko, ren } = await opened([]);
    await db.transaction(async (tx) => {
      const made = await startChange(tx, tag(bookId, { what: 'Shifted a relationship' }));
      await shiftRelationship(tx, made, null, { one: aiko.id, other: ren.id, what: `${mention(aiko.id)} forgives ${mention(ren.id)}.` });
    });
    const r = await change(app, cookie, bookId, { kind: 'leave', id: ren.id });
    expect(r.status).toBe(200);
    expect(r.body.setup.cast.map((person: Character) => person.name)).toEqual(['Sora']);
    // Lines show only between people still in the story.
    expect(r.body.setup.relationships).toEqual([]);

    expect((await personOf(bookId, ren.id)).role).toBe('left');
    const [scene] = await db.select().from(scenes).where(eq(scenes.bookId, bookId));
    expect(scene.present).toEqual([aiko.id]);
    expect(await db.select().from(relationships).where(eq(relationships.bookId, bookId))).toHaveLength(2);
    expect(await db.select().from(relationshipHistory).where(eq(relationshipHistory.bookId, bookId))).toHaveLength(1);
    const [note] = await notesIn(bookId);
    expect(noteText(note)).toContain('<changed subject="Ren leaves the story">');

    const protagonist = await change(app, cookie, bookId, { kind: 'leave', id: aiko.id });
    expect(protagonist.status).toBe(409);
    const again = await change(app, cookie, bookId, { kind: 'leave', id: ren.id });
    expect(again.status).toBe(409);
  });

  it('brings someone new into the cast, with the sheet the owner wrote', async () => {
    const { app, cookie, bookId } = await opened([]);
    const corwin = sheet('Corwin', { who: 'A lantern seller' });
    const r = await change(app, cookie, bookId, { kind: 'join', character: corwin });
    expect(r.body.setup.cast.map((person: Character) => person.name)).toEqual(['Ren', 'Sora', 'Corwin']);
    expect(await personOf(bookId, corwin.id)).toMatchObject({ role: 'cast', who: 'A lantern seller' });
    const [note] = await notesIn(bookId);
    expect(noteText(note)).toContain('<changed subject="Corwin joins the cast">');
    expect(noteText(note)).toContain('<now>A lantern seller</now>');

    const twice = await change(app, cookie, bookId, { kind: 'join', character: sheet('Corwin') });
    expect(twice.status).toBe(409);
  });

  it('ties two, changes a line, and unties two while what happened between them stays', async () => {
    const { app, cookie, bookId, aiko, ren, sora } = await opened([]);
    await change(app, cookie, bookId, { kind: 'line', relationship: line(sora, aiko, 'rivals') });
    await change(app, cookie, bookId, { kind: 'line', relationship: line(aiko, ren, 'strangers now') });
    await db.transaction(async (tx) => {
      const made = await startChange(tx, tag(bookId, { what: 'Shifted a relationship' }));
      await shiftRelationship(tx, made, null, { one: ren.id, other: sora.id, what: `${mention(ren.id)} lies to ${mention(sora.id)}.` });
    });
    await change(app, cookie, bookId, { kind: 'untie', a: sora.id, b: ren.id });

    const lines = await db.select().from(relationships).where(eq(relationships.bookId, bookId));
    expect(lines.map((each) => each.bond).sort()).toEqual(['rivals', 'strangers now']);
    expect(await db.select().from(relationshipHistory).where(eq(relationshipHistory.bookId, bookId))).toHaveLength(1);

    const told = (await notesIn(bookId)).map(noteText);
    expect(told[0]).toContain('<changed subject="Aiko and Sora are tied">');
    expect(told[0]).toContain('<field name="What they are to each other">\n<was>Nothing.</was>\n<now>rivals</now>');
    expect(told[1]).toContain('<changed subject="The relationship between Aiko and Ren">');
    expect(told[1]).toContain('<was>old friends</was>\n<now>strangers now</now>');
    expect(told[2]).toContain('<changed subject="Ren and Sora are no longer tied">');
  });

  it('changes the book’s choices and the world, the word goal following the length', async () => {
    const { app, cookie, bookId } = await opened([]);
    const choices = {
      title: 'The Lantern Road',
      length: 'novel' as const,
      pov: 'first' as const,
      darkness: 'mature' as const,
      world: { genre: 'Fantasy', tone: 'Hushed', setting: 'A river city, winter', rules: '', notes: '' },
    };
    const r = await change(app, cookie, bookId, { kind: 'book', book: choices });
    expect(r.body.setup).toMatchObject({ length: 'novel', pov: 'first', world: { tone: 'Hushed' } });
    const [book] = await db.select().from(books).where(eq(books.id, bookId));
    expect(book).toMatchObject({ length: 'novel', wordGoal: 80000, pov: 'first' });
    const [world] = await db.select().from(worlds).where(eq(worlds.bookId, bookId));
    expect(world.tone).toBe('Hushed');

    const [note] = await notesIn(bookId);
    const told = noteText(note);
    expect(told).toContain('<changed subject="The book">');
    expect(told).toContain('<field name="Length">');
    expect(told).toContain('<field name="Point of view">');
    expect(told).not.toContain('<field name="Title">');
    expect(told).toContain('<changed subject="The world">');
    expect(told).toContain('<field name="Tone">\n<was>Nothing.</was>\n<now>Hushed</now>');

    const renamed = await change(app, cookie, bookId, { kind: 'book', book: { ...choices, title: 'The River Road' } });
    expect(renamed.body.setup.title).toBe('The River Road');
  });
});

describe('a change that reaches back', () => {
  it('renames someone from the first page: the passages that name them rewritten and kept at once, the session started again from them', async () => {
    const { app, cookie, bookId, ren, proxy } = await opened([
      { text: 'Ren nods. Ren’s hands are cold.' },
      rewriting([
        { passage: 1, find: 'Ren', text: 'Renji' },
        { passage: 2, find: 'Ren', text: 'Renji' },
        { passage: 3, find: 'Ren', every: true, text: 'Renji' },
      ]),
      { text: 'Renji smiles.' },
    ]);
    await play(app, cookie, bookId, 'move', { voice: 'character', text: 'I thank Ren.' });
    const r = await change(app, cookie, bookId, { kind: 'sheet', character: { ...ren, name: 'Renji' } });
    expect(r.status).toBe(200);
    expect(r.events[0]).toEqual({ type: 'rewriting', done: 1, of: 1 });
    expect(r.body.setup.cast[0].name).toBe('Renji');

    // Only the passages that may name him go to Procreator, as the name will stand.
    const [asked] = rewriteCalls(proxy);
    const { system, user } = promptOf(asked);
    expect(system).toContain('rewrite_passages');
    expect(user).toContain('<cast>\nAiko, Renji, Sora\n</cast>');
    expect(user).toContain('<passages part="Scene 1">');
    expect(user).toContain('<passage n="1" where="Scene 1, turn 1: the opening you picked">\nRen pulls Aiko from the river.\n</passage>');
    expect(user).toContain('<passage n="3" where="Scene 1, turn 2: the narration">');
    expect(user).not.toContain('The river is cold.');
    expect(user).toContain('Ren is called Renji now, and always was.');
    const recorded = await db.select().from(calls).where(and(eq(calls.bookId, bookId), eq(calls.role, 'rewrite')));
    expect(recorded).toHaveLength(1);

    const played = await standingTurns(bookId);
    expect(played.map((turn) => [turn.input, turn.reply])).toEqual([
      ['Renji pulls Aiko from the river.', 'The river is cold.'],
      ['I thank Renji.', 'Renji nods. Renji’s hands are cold.'],
    ]);
    const [renamed, rewrote] = await changesWhat(bookId, 'Renamed Ren Renji');
    expect(renamed).toMatchObject({ by: 'owner', why: 'renamed, and the rest from now on', turnId: played[1].id });
    expect(rewrote).toMatchObject({ by: 'owner', why: REWROTE, turnId: played[1].id });
    expect(r.rewrote).toEqual({ change: rewrote.id, count: 3 });
    // A rename alone leaves nothing else to tell.
    expect(await notesIn(bookId)).toEqual([]);

    // The scene's session starts again, at no turn, from a fresh brief and the turns as they read now.
    const [scene] = await db.select().from(scenes).where(eq(scenes.bookId, bookId));
    const segments = await db.select().from(sessionSegments).where(eq(sessionSegments.sceneId, scene.id)).orderBy(asc(sessionSegments.number));
    expect(segments).toHaveLength(2);
    expect(segments[1].turnId).toBeNull();
    await play(app, cookie, bookId, 'move', { voice: 'character', text: 'I wave.' });
    const sent = lastSent(proxy);
    expect(sent[0]).toBe(segments[1].head);
    expect(sent).toContain('Renji nods. Renji’s hands are cold.');
    expect(sent).toContain('<move by="Aiko">I thank Renji.</move>');
    expect(sent.at(-1)).toBe('<move by="Aiko">I wave.</move>');
    expect(naming(sent, 'Ren')).toBe(false);

    // The play's page has a quiet line where it happened, and a tap shows each passage before and after.
    const view = await call(app, 'GET', `/v1/books/${bookId}/play`, cookie);
    expect(view.body.turns[1].marks).toEqual([{ kind: 'rewrote', change: rewrote.id, what: 'Renamed Ren Renji', count: 3 }]);
    const listed = await call(app, 'GET', `/v1/books/${bookId}/story/rewrites/${rewrote.id}`, cookie);
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({
      what: 'Renamed Ren Renji',
      passages: [
        { where: 'Scene 1, turn 1: the opening you picked', before: 'Ren pulls Aiko from the river.', after: 'Renji pulls Aiko from the river.' },
        { where: 'Scene 1, turn 2: your move', before: 'I thank Ren.', after: 'I thank Renji.' },
        { where: 'Scene 1, turn 2: the narration', before: 'Ren nods. Ren’s hands are cold.', after: 'Renji nods. Renji’s hands are cold.' },
      ],
    });
    const notOne = await call(app, 'GET', `/v1/books/${bookId}/story/rewrites/${renamed.id}`, cookie);
    expect(notOne.status).toBe(404);
  });

  it('keeps the rest of a renamed sheet from now on, told to Procreator after the session starts again', async () => {
    const { app, cookie, bookId, ren } = await opened([rewriting([{ passage: 1, find: 'Ren', text: 'Renji' }])]);
    const r = await change(app, cookie, bookId, { kind: 'sheet', character: { ...ren, name: 'Renji', past: 'A smuggler' } });
    expect(r.status).toBe(200);
    expect(await personOf(bookId, ren.id)).toMatchObject({ name: 'Renji', past: 'A smuggler' });
    const [renamed] = await changesWhat(bookId, 'Renamed Ren Renji, and changed the sheet');
    expect(renamed.why).toBe('renamed, and the rest from now on');

    const [note] = await notesIn(bookId);
    const told = noteText(note);
    expect(told).toContain('<field name="Past">\n<was>Nothing.</was>\n<now>A smuggler</now>');
    expect(told).not.toContain('<field name="Name">');
    const [scene] = await db.select().from(scenes).where(eq(scenes.bookId, bookId));
    const [, restarted] = await db.select().from(sessionSegments).where(eq(sessionSegments.sceneId, scene.id)).orderBy(asc(sessionSegments.number));
    expect(note.seq).toBeGreaterThan(restarted.fromSeq);
  });

  it('holds always so: what says otherwise is rewritten in every part, and edits that don’t fit go back to Procreator', async () => {
    const { app, cookie, bookId, ren, proxy } = await opened([
      rewriting([{ passage: 4, find: 'The sea is cold.', text: 'The sea is warm.' }]),
      rewriting([{ passage: 4, text: 'The river is cold. Ren knows it from his smuggling nights.' }]),
      rewriting([]),
      { text: 'Ren counts the crates.' },
    ]);
    const r = await change(app, cookie, bookId, { kind: 'sheet', character: { ...ren, past: 'A smuggler' } }, 'always');
    expect(r.status).toBe(200);
    expect(r.events.slice(0, 2)).toEqual([
      { type: 'rewriting', done: 1, of: 2 },
      { type: 'rewriting', done: 2, of: 2 },
    ]);
    expect(r.rewrote?.count).toBe(1);

    const asked = rewriteCalls(proxy);
    expect(asked).toHaveLength(3);
    expect(promptOf(asked[0]).user).toContain('<passage n="1" where="Scene 1: where it takes place">\nThe ferry\n</passage>');
    expect(promptOf(asked[0]).user).toContain('<field name="Past">\n<was>Nothing.</was>\n<now>A smuggler</now>');
    expect(promptOf(asked[0]).user).toContain('The rest of the change above holds always');
    expect(JSON.stringify(asked[1].body.contents)).toContain('Passage 4 doesn’t have “The sea is cold.”');
    // The rest of the story, but the sheet the change makes itself.
    const rest = promptOf(asked[2]).user;
    expect(rest).toContain('Aiko’s sheet: who they are');
    expect(rest).toContain('Aiko and Ren: what they are to each other');
    expect(rest).not.toContain('where="Ren’s sheet');

    expect((await personOf(bookId, ren.id)).past).toBe('A smuggler');
    const [opening] = await standingTurns(bookId);
    expect(opening.reply).toBe('The river is cold. Ren knows it from his smuggling nights.');
    const [made, rewrote] = await changesWhat(bookId, 'Changed Ren’s sheet');
    expect(made.why).toBe('always so');
    expect(rewrote.why).toBe(REWROTE);
    // Always so is no news to Procreator: the story always said so.
    expect(await notesIn(bookId)).toEqual([]);

    await play(app, cookie, bookId, 'move', { voice: 'character', text: 'I ask Ren about the crates.' });
    const sent = lastSent(proxy);
    expect(sent[0]).toContain('A smuggler');
    expect(sent).toContain('The river is cold. Ren knows it from his smuggling nights.');
  });

  it('writes someone out of everything played, always so, and takes them out whole', async () => {
    const { app, cookie, bookId, aiko, ren, proxy } = await opened([
      { text: 'Ren nods.' },
      rewriting([
        { passage: 3, text: 'A stranger pulls Aiko from the river.' },
        { passage: 5, text: 'I thank the stranger.' },
        { passage: 6, text: 'The stranger nods.' },
      ]),
      rewriting([]),
    ]);
    await play(app, cookie, bookId, 'move', { voice: 'character', text: 'I thank Ren.' });
    const r = await change(app, cookie, bookId, { kind: 'leave', id: ren.id }, 'always');
    expect(r.status).toBe(200);
    expect(r.body.setup.cast.map((person: Character) => person.name)).toEqual(['Sora']);

    const [asked] = rewriteCalls(proxy);
    expect(promptOf(asked).user).toContain('<cast>\nAiko, Sora\n</cast>');
    expect(promptOf(asked).user).toContain('Ren was never in the story.');

    expect(await personOf(bookId, ren.id)).toBeUndefined();
    expect(await db.select().from(relationships).where(eq(relationships.bookId, bookId))).toEqual([]);
    const [scene] = await db.select().from(scenes).where(eq(scenes.bookId, bookId));
    expect(scene.present).toEqual([aiko.id]);
    const played = await standingTurns(bookId);
    expect(played.map((turn) => [turn.input, turn.reply])).toEqual([
      ['A stranger pulls Aiko from the river.', 'The river is cold.'],
      ['I thank the stranger.', 'The stranger nods.'],
    ]);
    const [out] = await changesWhat(bookId, 'Wrote Ren out of the story');
    expect(out.why).toBe('always so');
    expect(r.rewrote?.count).toBe(3);
  });

  it('starts each actor’s chat again from who they are now and their chat as it reads now', async () => {
    const { app, cookie, bookId, ren } = await opened([
      { calls: [{ name: 'cue', args: { who: 'Ren', sees: 'Aiko asks you to row, Ren.' } }] },
      { text: 'I row.' },
      { text: 'Ren rowed.' },
      rewriting([
        { passage: 1, find: 'Ren', text: 'Renji' },
        { passage: 2, find: 'Ren', text: 'Renji' },
        { passage: 3, find: 'Ren', text: 'Renji' },
        { passage: 4, find: 'Ren', every: true, text: 'Renji' },
      ]),
    ]);
    await play(app, cookie, bookId, 'move', { voice: 'character', text: 'I ask Ren to row.' });
    const r = await change(app, cookie, bookId, { kind: 'sheet', character: { ...ren, name: 'Renji' } });
    expect(r.status).toBe(200);
    // The actor's chat isn't the story, so only the turns count as rewritten.
    expect(r.rewrote?.count).toBe(3);

    const segments = await db
      .select()
      .from(actorSegments)
      .where(and(eq(actorSegments.bookId, bookId), eq(actorSegments.characterId, ren.id)))
      .orderBy(asc(actorSegments.number));
    expect(segments).toHaveLength(2);
    expect(segments[1].turnId).toBeNull();
    expect(segments[1].head).toContain('<you name="Renji">');
    const chat = await db
      .select()
      .from(actorMessages)
      .where(and(eq(actorMessages.bookId, bookId), eq(actorMessages.characterId, ren.id)))
      .orderBy(asc(actorMessages.seq));
    const [turn] = (await standingTurns(bookId)).slice(1);
    expect(chat.map((row) => [row.seq >= segments[1].fromSeq, row.turnId])).toEqual([
      [false, turn.id],
      [false, turn.id],
      [true, turn.id],
      [true, turn.id],
    ]);
    const cue = (chat[2].message as { content: string }).content;
    expect(cue).toContain('Aiko asks you to row, Renji.');
    expect(naming([cue], 'Ren')).toBe(false);
  });

  it('keeps the rename and its rewrite when the turn after is taken back, giving the owner’s words back as they read now', async () => {
    const { app, cookie, bookId, ren, proxy } = await opened([
      { text: 'Ren nods.' },
      rewriting([
        { passage: 1, find: 'Ren', text: 'Renji' },
        { passage: 2, find: 'Ren', text: 'Renji' },
        { passage: 3, find: 'Ren', text: 'Renji' },
      ]),
      { text: 'Renji waves back.' },
    ]);
    await play(app, cookie, bookId, 'move', { voice: 'character', text: 'I thank Ren.' });
    await change(app, cookie, bookId, { kind: 'sheet', character: { ...ren, name: 'Renji' } });
    const undone = await play(app, cookie, bookId, 'undo');
    expect(undone.status).toBe(200);
    expect(JSON.parse(undone.text).words).toBe('I thank Renji.');

    expect((await personOf(bookId, ren.id)).name).toBe('Renji');
    const [opening] = await standingTurns(bookId);
    expect(opening.input).toBe('Renji pulls Aiko from the river.');
    const [, rewrote] = await changesWhat(bookId, 'Renamed Ren Renji');
    expect(rewrote.takenBackBy).toBeNull();

    await play(app, cookie, bookId, 'move', { voice: 'character', text: 'I wave.' });
    const sent = lastSent(proxy);
    expect(sent.some((text) => text.includes('Renji pulls Aiko from the river.'))).toBe(true);
    expect(sent).not.toContain('<move by="Aiko">I thank Renji.</move>');
    expect(naming(sent, 'Ren')).toBe(false);
  });

  it('asks for Procreator before anything changes: offline, nothing reaches back', async () => {
    const { cookie, bookId, ren, email } = await opened([]);
    const offline = writer({ WRITER_EMAILS: [email] });
    const r = await change(offline, cookie, bookId, { kind: 'sheet', character: { ...ren, name: 'Renji' } });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('ai_offline');
    // A change from now on needs no Procreator.
    const now = await change(offline, cookie, bookId, { kind: 'sheet', character: { ...ren, past: 'A smuggler' } });
    expect(now.status).toBe(200);
    expect((await personOf(bookId, ren.id)).name).toBe('Ren');
  });

  it('keeps nothing when Procreator doesn’t answer', async () => {
    const { app, cookie, bookId, ren } = await opened([{ status: 400 }]);
    const r = await change(app, cookie, bookId, { kind: 'sheet', character: { ...ren, name: 'Renji' } });
    expect(r.status).toBe(502);
    expect(r.body).toMatchObject({ type: 'error', code: 'ai_failed' });
    expect(r.body.story.setup.cast[0].name).toBe('Ren');
    expect((await personOf(bookId, ren.id)).name).toBe('Ren');
    expect(await changesWhat(bookId, 'Renamed Ren Renji')).toEqual([]);
    const [opening] = await standingTurns(bookId);
    expect(opening.input).toBe('Ren pulls Aiko from the river.');
  });
});

describe('a change before anything is played', () => {
  it('has no past to keep: someone taken out goes whole, and the session starts again from a fresh brief', async () => {
    const { app, cookie, bookId, aiko, ren, sora, proxy } = await offered([{ text: 'The river is cold.' }]);
    const r = await change(app, cookie, bookId, { kind: 'leave', id: ren.id }, 'always');
    expect(r.status).toBe(200);
    expect(r.body.played).toBe(false);

    expect(await personOf(bookId, ren.id)).toBeUndefined();
    const lines = await db.select().from(relationships).where(eq(relationships.bookId, bookId));
    expect(lines).toEqual([]);
    const [scene] = await db.select().from(scenes).where(eq(scenes.bookId, bookId));
    expect(scene.present).toEqual([aiko.id, sora.id]);
    expect(await notesIn(bookId)).toEqual([]);
    const segments = await db.select().from(sessionSegments).where(eq(sessionSegments.sceneId, scene.id)).orderBy(asc(sessionSegments.number));
    expect(segments).toHaveLength(2);
    expect(segments[1].head).not.toMatch(/\bRen\b/);
    expect(segments[1].head).toContain('Present: Aiko, Sora');

    // The opening offered with Ren in it opens without him, from the fresh brief.
    await play(app, cookie, bookId, 'open', { kind: 'pick', opening: 1 });
    const [opened] = await db.select().from(scenes).where(eq(scenes.bookId, bookId));
    expect(opened.present).toEqual([aiko.id]);
    const sent = lastSent(proxy);
    expect(sent[0]).toBe(segments[1].head);
    expect(sent.some((text) => text.startsWith('<openings>'))).toBe(false);
  });

  it('takes a renamed sheet as it is', async () => {
    const { app, cookie, bookId, ren } = await offered([]);
    const r = await change(app, cookie, bookId, { kind: 'sheet', character: { ...ren, name: 'Renji' } });
    expect(r.status).toBe(200);
    expect((await personOf(bookId, ren.id)).name).toBe('Renji');
  });
});
