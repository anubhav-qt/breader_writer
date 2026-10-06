import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { BookSetup, Character } from '@writer/shared/book';
import { createBook } from '../src/books/setup.ts';
import { scenes, turns } from '../src/db/schema.ts';
import { startChange, type Tag, type Writer } from '../src/story/changes.ts';
import { remember } from '../src/story/memory.ts';
import { mention } from '../src/story/mentions.ts';
import { writePage } from '../src/story/pages.ts';
import { shiftRelationship } from '../src/story/relationships.ts';
import { addTurn, endScene, setReply, startScene, type Scene } from '../src/story/scenes.ts';
import { deps } from './helpers.ts';

/*
 * Books with stories in them, made the way the story makes them: through the change log.
 */

const db = deps.db;

export function sheet(name: string, over: Partial<Character> = {}): Character {
  return { id: randomUUID(), name, who: '', personality: '', past: '', notes: '', ...over };
}

export function tag(bookId: string, over: Partial<Tag> = {}): Tag {
  return { bookId, turnId: null, by: 'agent', what: 'Something happened', ...over };
}

/** Who writes pages and memory: the agent, at no turn unless said. */
export function writer(bookId: string, over: Partial<Writer> = {}): Writer {
  return { bookId, turnId: null, by: 'agent', ...over };
}

/** A novella with Aiko, the protagonist, and Ren and Sora in the cast. Aiko and Ren are tied, and Ren and Sora. */
export async function aBook(userId = `user-${randomUUID()}`) {
  const aiko = sheet('Aiko', { who: 'A lamplighter', personality: 'Stubborn, kind' });
  const ren = sheet('Ren', { who: 'The ferryman’s son' });
  const sora = sheet('Sora');
  const setup: BookSetup = {
    title: 'The Lantern Road',
    color: 'teal',
    length: 'novella',
    pov: 'third_close',
    darkness: 'mature',
    world: { genre: 'Fantasy', tone: '', setting: 'A river city, winter', rules: '', notes: '' },
    protagonist: aiko,
    cast: [ren, sora],
    relationships: [
      { bond: 'old friends', a: { id: aiko.id, sees: 'a brother', hides: 'that she saw him at the docks' }, b: { id: ren.id, sees: '', hides: '' } },
      { bond: 'cousins', a: { id: ren.id, sees: '', hides: '' }, b: { id: sora.id, sees: '', hides: '' } },
    ],
  };
  const card = await createBook(db, userId, setup);
  return { bookId: card.id, userId, aiko, ren, sora };
}

/** Starts the book's next scene. */
export async function nextScene(bookId: string, place: string, present: string[]): Promise<Scene> {
  return db.transaction(async (tx) => {
    const change = await startChange(tx, tag(bookId, { what: 'Started a scene' }));
    return startScene(tx, change, { place, time: 'Dusk', present });
  });
}

/** Ends a scene. */
export async function end(bookId: string, scene: Scene): Promise<Scene> {
  return db.transaction(async (tx) => {
    const change = await startChange(tx, tag(bookId, { what: 'Ended a scene' }));
    return endScene(tx, change, scene);
  });
}

/** A book with its first scene playing, at the ferry with Aiko and Ren. */
export async function aScene() {
  const book = await aBook();
  const scene = await nextScene(book.bookId, 'The ferry', [book.aiko.id, book.ren.id]);
  return { ...book, scene };
}

/**
 * A book played into its second scene. Scene 1, at the Lamp House with Aiko, had one turn, has
 * ended and is wrapped up. The reference has Aiko's page, the Lamp House's, and the Plan, Threads
 * and Timeline; memory has a note; Aiko and Ren's line has a history. Scene 2 is playing at the
 * ferry with Aiko and Ren, two turns in, one of them an author note, and a third taken back.
 */
export async function aPlayedStory() {
  const book = await aBook();
  const { bookId, aiko, ren } = book;

  const first = await db.transaction(async (tx) => {
    const change = await startChange(tx, tag(bookId, { what: 'Started a scene' }));
    return startScene(tx, change, { place: 'The Lamp House, at the top of the stairs', time: 'Morning', present: [aiko.id] });
  });
  const opening = await addTurn(db, first, 'character', 'I light the first lamp.');
  await setReply(db, opening, 'The wick catches. Ren is at the door.');
  const by = writer(bookId, { turnId: opening.id });
  await db.transaction(async (tx) => {
    await writePage(tx, by, { title: 'Aiko', kind: 'character', about: '', body: 'Afraid of deep water since the flood.' });
    await writePage(tx, by, {
      title: 'The Lamp House',
      kind: 'place',
      about: 'Where the city’s lamps are kept.',
      body: 'A narrow house of oil and wicks. [[Ren]] owes its keeper money.',
    });
    await writePage(tx, by, { title: 'Plan', kind: 'story', about: 'Where the story is heading.', body: '[[Aiko]] crosses the river and learns who cut the rope.' });
    await writePage(tx, by, { title: 'Threads', kind: 'story', about: 'What the story has set up.', body: '- Who cut the ferry rope?' });
    await writePage(tx, by, { title: 'Timeline', kind: 'story', about: 'What happened when.', body: '- Twenty years before: the flood took the old bridge.' });
    await remember(tx, by, 'The owner wants [[Ren]] kept likeable.');
    const change = await startChange(tx, tag(bookId, { turnId: opening.id, what: 'Shifted a relationship' }));
    await shiftRelationship(tx, change, first.id, { one: aiko.id, other: ren.id, what: `${mention(aiko.id)} forgives ${mention(ren.id)} for leaving.` });
    await endScene(tx, change, first);
  });
  await db.update(scenes).set({ summary: 'Aiko lit the first lamp, and Ren came to the door.' }).where(eq(scenes.id, first.id));

  const second = await nextScene(bookId, 'The ferry', [aiko.id, ren.id]);
  const move = await addTurn(db, second, 'character', 'I ask Ren who cut the rope.');
  await setReply(db, move, '"Not me," Ren says, too quickly.');
  const note = await addTurn(db, second, 'author', 'Make the river rise.');
  await setReply(db, note, 'The water climbs the hull.');
  const undone = await addTurn(db, second, 'character', 'I jump.');
  await db.update(turns).set({ undone: true }).where(eq(turns.id, undone.id));

  return { ...book, first, second, opening, move, note };
}
