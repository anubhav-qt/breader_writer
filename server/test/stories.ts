import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { BookSetup, Character } from '@writer/shared/book';
import { createBook } from '../src/books/setup.ts';
import { scenes, turns } from '../src/db/schema.ts';
import { startChange, type Tag } from '../src/story/changes.ts';
import {
  addGrowth,
  addToTimeline,
  closeThread,
  openThread,
  recordFact,
  setArc,
  shiftRelationship,
} from '../src/story/ledger.ts';
import { mention } from '../src/story/mentions.ts';
import { addTurn, endScene, setReply, startScene } from '../src/story/scenes.ts';
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

/** A novella with Aiko, the protagonist, and Ren and Sora in the cast. Aiko and Ren are tied. */
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

/** A book with its first scene playing. */
export async function aScene() {
  const book = await aBook();
  const scene = await db.transaction(async (tx) => {
    const change = await startChange(tx, tag(book.bookId, { what: 'Started a scene' }));
    return startScene(tx, change, { place: 'The ferry', time: 'Dusk', present: [book.aiko.id, book.ren.id] });
  });
  return { ...book, scene };
}

/**
 * A book played into its second scene. Scene 1 has ended and folded (its one turn into its
 * summary). Scene 2 is playing at the ferry with Aiko and Ren, two turns in, one of them an
 * author note. Something is in every ledger.
 */
export async function aPlayedStory() {
  const book = await aBook();
  const { bookId, aiko, ren } = book;
  const a = mention(aiko.id);
  const r = mention(ren.id);

  const first = await db.transaction(async (tx) => {
    const change = await startChange(tx, tag(bookId, { what: 'Started a scene' }));
    return startScene(tx, change, { place: 'The lamp house', time: 'Morning', present: [aiko.id] });
  });
  const opening = await addTurn(db, first, 'character', 'I light the first lamp.');
  await setReply(db, opening, 'The wick catches. Ren is at the door.');
  await db.transaction(async (tx) => {
    const change = await startChange(tx, tag(bookId, { turnId: opening.id }));
    await recordFact(tx, change, null, `${r} owes the guild money.`);
    await recordFact(tx, change, first.id, `${a} can’t swim.`);
    await addToTimeline(tx, change, null, 'Twenty years before', 'The flood took the old bridge.');
    await addGrowth(tx, change, aiko.id, first.id, 'Afraid of deep water since the flood.');
    await shiftRelationship(tx, change, first.id, { one: aiko.id, other: ren.id, what: `${a} forgives ${r} for leaving.` });
    await openThread(tx, change, first.id, 'Who cut the ferry rope?');
    const letter = await openThread(tx, change, first.id, 'The unopened letter.');
    await closeThread(tx, change, letter.id, first.id, `${a} burns it.`);
    await setArc(tx, change, `${a} crosses the river and learns who cut the rope.`);
    await endScene(tx, change, first);
  });
  await db.update(scenes).set({ summary: 'Aiko lit the first lamp, and Ren came to the door.', foldedThrough: opening.number }).where(eq(scenes.id, first.id));

  const second = await db.transaction(async (tx) => {
    const change = await startChange(tx, tag(bookId, { turnId: opening.id, what: 'Started a scene' }));
    const scene = await startScene(tx, change, { place: 'The ferry', time: 'Dusk', present: [aiko.id, ren.id] });
    await addToTimeline(tx, change, scene.id, 'Dusk', 'They cross.');
    return scene;
  });
  const move = await addTurn(db, second, 'character', 'I ask Ren who cut the rope.');
  await setReply(db, move, '"Not me," Ren says, too quickly.');
  const note = await addTurn(db, second, 'author', 'Make the river rise.');
  await setReply(db, note, 'The water climbs the hull.');
  const undone = await addTurn(db, second, 'character', 'I jump.');
  await db.update(turns).set({ undone: true }).where(eq(turns.id, undone.id));

  return { ...book, first, second, opening, move, note };
}
