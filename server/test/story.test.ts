import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { BookSetup, Character } from '@writer/shared/book';
import { createBook } from '../src/books/setup.ts';
import { books, changes, facts, relationships, scenes, turns } from '../src/db/schema.ts';
import { edit, remove, startChange, takeBack, versionsOf, type Tag } from '../src/story/changes.ts';
import { closeThread, openThread, recordFact, setArc, shiftRelationship } from '../src/story/ledger.ts';
import { mention } from '../src/story/mentions.ts';
import { addTurn, endScene, playingScene, setReply, startScene, turnsOf } from '../src/story/scenes.ts';
import { deps } from './helpers.ts';

const db = deps.db;

function sheet(name: string): Character {
  return { id: randomUUID(), name, who: '', personality: '', past: '', notes: '' };
}

/** A book with Aiko, the protagonist, and Ren and Sora in the cast. Ren and Aiko are tied. */
async function aBook() {
  const aiko = sheet('Aiko');
  const ren = sheet('Ren');
  const sora = sheet('Sora');
  const setup: BookSetup = {
    title: 'The Lantern Road',
    color: 'teal',
    length: 'novella',
    pov: 'third_close',
    darkness: 'mature',
    world: { genre: 'Fantasy', tone: '', setting: '', rules: '', notes: '' },
    protagonist: aiko,
    cast: [ren, sora],
    relationships: [{ bond: 'old friends', a: { id: aiko.id, sees: 'a brother', hides: '' }, b: { id: ren.id, sees: '', hides: '' } }],
  };
  const card = await createBook(db, `user-${randomUUID()}`, setup);
  return { bookId: card.id, aiko, ren, sora };
}

function tag(bookId: string, over: Partial<Tag> = {}): Tag {
  return { bookId, turnId: null, by: 'agent', what: 'Something happened', ...over };
}

/** A book with its first scene playing. */
async function aScene() {
  const book = await aBook();
  const scene = await db.transaction(async (tx) => {
    const change = await startChange(tx, tag(book.bookId, { what: 'Started a scene' }));
    return startScene(tx, change, { place: 'The ferry', time: 'Dusk', present: [book.aiko.id, book.ren.id] });
  });
  return { ...book, scene };
}

describe('scenes and turns', () => {
  it('numbers scenes, and plays one at a time', async () => {
    const { bookId, scene } = await aScene();
    expect(scene).toMatchObject({ number: 1, status: 'playing', place: 'The ferry', foldedThrough: 0 });

    const second = db.transaction(async (tx) => {
      const change = await startChange(tx, tag(bookId));
      return startScene(tx, change, { place: '', time: '', present: [] });
    });
    await expect(second).rejects.toThrow('Scene 1 is still playing. End it first.');

    const next = await db.transaction(async (tx) => {
      const change = await startChange(tx, tag(bookId));
      await endScene(tx, change, scene);
      return startScene(tx, change, { place: 'The far bank', time: 'Night', present: [] });
    });
    expect(next.number).toBe(2);
    expect((await playingScene(db, bookId))?.id).toBe(next.id);
  });

  it('numbers turns through the book, writes a reply once, and leaves undone turns out', async () => {
    const { scene } = await aScene();
    const first = await addTurn(db, scene, 'character', 'I wave at Ren.');
    const second = await addTurn(db, scene, 'author', 'Make the river rise.');
    expect([first.number, second.number]).toEqual([1, 2]);

    await setReply(db, first, 'Ren waves back.');
    await expect(setReply(db, first, 'Ren ignores her.')).rejects.toThrow('Turn 1 has its reply already.');

    await db.update(turns).set({ undone: true }).where(eq(turns.id, second.id));
    const standing = await turnsOf(db, scene.id);
    expect(standing.map((turn) => turn.reply)).toEqual(['Ren waves back.']);
  });
});

describe('the change log', () => {
  it('tags each change and keeps what it made', async () => {
    const { bookId, aiko, scene } = await aScene();
    const turn = await addTurn(db, scene, 'character', 'I look at the water.');
    const { change, fact } = await db.transaction(async (tx) => {
      const change = await startChange(tx, tag(bookId, { turnId: turn.id, what: 'Recorded a fact' }));
      const fact = await recordFact(tx, change, scene.id, `${mention(aiko.id)} can't swim.`);
      return { change, fact };
    });
    expect(change).toMatchObject({ bookId, turnId: turn.id, by: 'agent', what: 'Recorded a fact', takenBackBy: null });
    const kept = await versionsOf(db, change.id);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ table: 'facts', key: { id: fact.id }, before: null, after: { text: `<@${aiko.id}> can't swim.` } });
  });

  it('turns away text that is empty or mentions someone not in the cast', async () => {
    const { bookId, scene } = await aScene();
    const stranger = randomUUID();
    const unknown = db.transaction(async (tx) => {
      const change = await startChange(tx, tag(bookId));
      return recordFact(tx, change, scene.id, `${mention(stranger)} is watching.`);
    });
    await expect(unknown).rejects.toThrow(`<@${stranger}> isn't anyone in the cast.`);
    const empty = db.transaction(async (tx) => {
      const change = await startChange(tx, tag(bookId));
      return recordFact(tx, change, scene.id, '   ');
    });
    await expect(empty).rejects.toThrow('The text is empty.');
  });

  it('shifts a relationship in the order it is stored, ties a new one, and keeps its history', async () => {
    const { bookId, aiko, ren, sora, scene } = await aScene();
    const change = await db.transaction(async (tx) => {
      const change = await startChange(tx, tag(bookId, { what: 'Shifted relationships' }));
      await shiftRelationship(tx, change, scene.id, {
        one: ren.id,
        other: aiko.id,
        bond: 'old friends, now wary',
        sides: [{ id: aiko.id, sees: 'a liar' }],
        what: `${mention(aiko.id)} catches ${mention(ren.id)} lying about the ferry.`,
      });
      await shiftRelationship(tx, change, scene.id, { one: sora.id, other: aiko.id, what: 'They meet.' });
      return change;
    });

    const lines = await db.select().from(relationships).where(eq(relationships.bookId, bookId));
    expect(lines).toHaveLength(2);
    const withRen = lines.find((line) => line.aId === [aiko.id, ren.id].sort()[0] && line.bId === [aiko.id, ren.id].sort()[1]);
    expect(withRen?.bond).toBe('old friends, now wary');
    if (aiko.id < ren.id) {
      expect(withRen?.aSees).toBe('a liar');
    } else {
      expect(withRen?.bSees).toBe('a liar');
    }

    const kept = await versionsOf(db, change.id);
    expect(kept.map((version) => version.table)).toEqual([
      'relationships',
      'relationship_history',
      'relationships',
      'relationship_history',
    ]);
    // An edit keeps only what it changed, as it was.
    expect(Object.keys(kept[0].before as object).sort()).toEqual(aiko.id < ren.id ? ['aSees', 'bond'] : ['bSees', 'bond']);
    expect((kept[0].before as { bond: string }).bond).toBe('old friends');
  });

  it('takes a change back, putting every row the way it was, as a change of its own', async () => {
    const { bookId, aiko, ren, scene } = await aScene();
    const earlier = await db.transaction(async (tx) => {
      const change = await startChange(tx, tag(bookId));
      return recordFact(tx, change, null, 'The river is wide.');
    });
    const change = await db.transaction(async (tx) => {
      const change = await startChange(tx, tag(bookId, { what: 'A busy turn' }));
      await recordFact(tx, change, scene.id, `${mention(ren.id)} owns the ferry.`);
      await shiftRelationship(tx, change, scene.id, { one: aiko.id, other: ren.id, bond: 'rivals', what: 'They fall out.' });
      await remove(tx, change, facts, { id: earlier.id });
      await setArc(tx, change, 'Aiko crosses the river.');
      return change;
    });

    const back = await db.transaction((tx) => takeBack(tx, change.id, { turnId: null, by: 'owner' }));
    expect(back).toMatchObject({ by: 'owner', what: 'Took back: A busy turn' });

    const left = await db.select().from(facts).where(eq(facts.bookId, bookId));
    expect(left).toEqual([earlier]);
    const [line] = await db.select().from(relationships).where(eq(relationships.bookId, bookId));
    expect(line.bond).toBe('old friends');
    const [original] = await db.select().from(changes).where(eq(changes.id, change.id));
    expect(original.takenBackBy).toBe(back.id);
    expect(await versionsOf(db, back.id)).toHaveLength(5);
  });

  it('brings back a removed row with its times', async () => {
    const { bookId, scene } = await aScene();
    const turn = await addTurn(db, scene, 'character', 'I jump in.');
    const change = await db.transaction(async (tx) => {
      const change = await startChange(tx, tag(bookId));
      await remove(tx, change, turns, { id: turn.id });
      return change;
    });
    await db.transaction((tx) => takeBack(tx, change.id, { turnId: null, by: 'owner' }));
    const [again] = await db.select().from(turns).where(eq(turns.id, turn.id));
    expect(again).toEqual(turn);
  });

  it('waits for a later change to the same row to be taken back first', async () => {
    const { bookId, scene } = await aScene();
    const opened = await db.transaction(async (tx) => {
      const change = await startChange(tx, tag(bookId, { what: 'Opened a thread' }));
      const thread = await openThread(tx, change, scene.id, 'Who cut the rope?');
      return { change, thread };
    });
    const closed = await db.transaction(async (tx) => {
      const change = await startChange(tx, tag(bookId, { what: 'Closed a thread' }));
      await closeThread(tx, change, opened.thread.id, scene.id, 'The ferryman did.');
      return change;
    });

    const early = db.transaction((tx) => takeBack(tx, opened.change.id, { turnId: null, by: 'owner' }));
    await expect(early).rejects.toThrow(`Change ${closed.id} changed the same thing later. Take it back first.`);

    await db.transaction((tx) => takeBack(tx, closed.id, { turnId: null, by: 'owner' }));
    await db.transaction((tx) => takeBack(tx, opened.change.id, { turnId: null, by: 'owner' }));
  });

  it('takes a change back once, and never takes back a take-back', async () => {
    const { bookId, scene } = await aScene();
    const change = await db.transaction(async (tx) => {
      const change = await startChange(tx, tag(bookId));
      await edit(tx, change, scenes, { id: scene.id }, { place: 'Mid river' });
      return change;
    });
    const back = await db.transaction((tx) => takeBack(tx, change.id, { turnId: null, by: 'agent' }));
    const [restored] = await db.select().from(scenes).where(eq(scenes.id, scene.id));
    expect(restored.place).toBe('The ferry');

    const twice = db.transaction((tx) => takeBack(tx, change.id, { turnId: null, by: 'agent' }));
    await expect(twice).rejects.toThrow(`Change ${change.id} was already taken back.`);
    const backAgain = db.transaction((tx) => takeBack(tx, back.id, { turnId: null, by: 'agent' }));
    await expect(backAgain).rejects.toThrow(`Change ${back.id} took another back`);
  });

  it('goes with its book', async () => {
    const { bookId, aiko, scene } = await aScene();
    const turn = await addTurn(db, scene, 'character', 'I wave.');
    await db.transaction(async (tx) => {
      const change = await startChange(tx, tag(bookId, { turnId: turn.id }));
      await recordFact(tx, change, scene.id, `${mention(aiko.id)} waved.`);
    });
    await db.delete(books).where(eq(books.id, bookId));
    const left = await db.select().from(changes).where(and(eq(changes.bookId, bookId)));
    expect(left).toEqual([]);
  });
});
