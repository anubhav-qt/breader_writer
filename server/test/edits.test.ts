import { and, asc, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import type { Character, Relationship } from '@writer/shared/book';
import type { StoryEdit } from '@writer/shared/story';
import { users } from '../src/db/breader.ts';
import { books, changes, characters, relationshipHistory, relationships, scenes, sessionMessages, sessionSegments, turns, worlds } from '../src/db/schema.ts';
import { startChange } from '../src/story/changes.ts';
import { mention } from '../src/story/mentions.ts';
import { shiftRelationship } from '../src/story/relationships.ts';
import { ORIGIN, account, address, call, deps, send, writer, type Writer } from './helpers.ts';
import { antigravity, catalogOf, fakeProxy, textsOf, type FakeProxy, type Reply } from './proxy.ts';
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
  return { proxy, app, cookie, ...book };
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

async function change(app: Writer, cookie: string, bookId: string, edit: StoryEdit, reach: 'now' | 'always' = 'now') {
  return send(app, 'POST', `/v1/books/${bookId}/story/edits`, cookie, { edit, reach });
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

    const made = await changeWhat(bookId, 'Changed Ren\'s sheet');
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
    const made = await changeWhat(bookId, 'Changed Ren\'s sheet');
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
    expect(await changeWhat(bookId, 'Changed Ren\'s sheet')).toBeUndefined();
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

  it('can’t yet reach back: always so and a rename are turned away once anything is played', async () => {
    const { app, cookie, bookId, ren } = await opened([]);
    const always = await change(app, cookie, bookId, { kind: 'sheet', character: { ...ren, past: 'A smuggler' } }, 'always');
    expect(always.status).toBe(409);
    const renamed = await change(app, cookie, bookId, { kind: 'sheet', character: { ...ren, name: 'Renji' } });
    expect(renamed.status).toBe(409);
    expect((await personOf(bookId, ren.id)).name).toBe('Ren');
    expect(await notesIn(bookId)).toEqual([]);
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
