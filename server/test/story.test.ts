import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { books, changes, notes, pages, relationships, scenes, turns } from '../src/db/schema.ts';
import { edit, make, remove, startChange, takeBack, versionsOf } from '../src/story/changes.ts';
import { remember } from '../src/story/memory.ts';
import { mention } from '../src/story/mentions.ts';
import { editPage, writePage } from '../src/story/pages.ts';
import { shiftRelationship } from '../src/story/relationships.ts';
import { addTurn, endScene, playingScene, setReply, startScene, turnsOf } from '../src/story/scenes.ts';
import { deps } from './helpers.ts';
import { aScene, tag, writer } from './stories.ts';

const db = deps.db;

async function latestChange(bookId: string) {
  const [change] = await db.select().from(changes).where(eq(changes.bookId, bookId)).orderBy(desc(changes.id)).limit(1);
  return change;
}

describe('scenes and turns', () => {
  it('numbers scenes, and plays one at a time', async () => {
    const { bookId, scene } = await aScene();
    expect(scene).toMatchObject({ number: 1, status: 'playing', place: 'The ferry', summary: '' });

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
    const written = await db.transaction((tx) =>
      writePage(tx, writer(bookId, { turnId: turn.id }), { title: 'The Ferry', kind: 'place', about: 'The boat across.', body: "[[Aiko]] can't swim." }),
    );
    const change = await latestChange(bookId);
    expect(change).toMatchObject({ bookId, turnId: turn.id, by: 'agent', what: 'Wrote the page The Ferry', takenBackBy: null });
    const kept = await versionsOf(db, change.id);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ table: 'pages', key: { id: written.page.id }, before: null, after: { body: `<@${aiko.id}> can't swim.` } });
  });

  it('turns away a relationship shift that is empty or mentions someone not in the cast', async () => {
    const { bookId, aiko, ren, scene } = await aScene();
    const stranger = randomUUID();
    const unknown = db.transaction(async (tx) => {
      const change = await startChange(tx, tag(bookId));
      return shiftRelationship(tx, change, scene.id, { one: aiko.id, other: ren.id, what: `${mention(stranger)} is watching.` });
    });
    await expect(unknown).rejects.toThrow(`<@${stranger}> isn't anyone in the cast.`);
    const empty = db.transaction(async (tx) => {
      const change = await startChange(tx, tag(bookId));
      return shiftRelationship(tx, change, scene.id, { one: aiko.id, other: ren.id, what: '   ' });
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
    expect(lines).toHaveLength(3);
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
    const earlier = await db.transaction((tx) => remember(tx, writer(bookId), 'The owner likes the river cold.'));
    const change = await db.transaction(async (tx) => {
      const change = await startChange(tx, tag(bookId, { what: 'A busy turn' }));
      await make(tx, change, pages, { bookId, kind: 'place', title: 'The Ferry', about: 'The boat across.', body: `${mention(ren.id)} owns the ferry.` });
      await shiftRelationship(tx, change, scene.id, { one: aiko.id, other: ren.id, bond: 'rivals', what: 'They fall out.' });
      await remove(tx, change, notes, { id: earlier.note.id });
      return change;
    });

    const back = await db.transaction((tx) => takeBack(tx, change.id, { turnId: null, by: 'owner' }));
    expect(back).toMatchObject({ by: 'owner', what: 'Took back: A busy turn' });

    expect(await db.select().from(pages).where(eq(pages.bookId, bookId))).toEqual([]);
    expect(await db.select().from(notes).where(eq(notes.bookId, bookId))).toEqual([earlier.note]);
    const lines = await db.select().from(relationships).where(eq(relationships.bookId, bookId));
    expect(lines.map((line) => line.bond).sort()).toEqual(['cousins', 'old friends']);
    const [original] = await db.select().from(changes).where(eq(changes.id, change.id));
    expect(original.takenBackBy).toBe(back.id);
    expect(await versionsOf(db, back.id)).toHaveLength(4);
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
    const { bookId } = await aScene();
    await db.transaction((tx) => writePage(tx, writer(bookId), { title: 'Threads', kind: 'story', about: 'What is set up.', body: '- Who cut the rope?' }));
    const wrote = await latestChange(bookId);
    await db.transaction((tx) => editPage(tx, writer(bookId), { title: 'Threads', find: '', replace: '- The unopened letter.' }));
    const added = await latestChange(bookId);

    const early = db.transaction((tx) => takeBack(tx, wrote.id, { turnId: null, by: 'owner' }));
    await expect(early).rejects.toThrow(`Change ${added.id} changed the same thing later. Take it back first.`);

    await db.transaction((tx) => takeBack(tx, added.id, { turnId: null, by: 'owner' }));
    await db.transaction((tx) => takeBack(tx, wrote.id, { turnId: null, by: 'owner' }));
    expect(await db.select().from(pages).where(eq(pages.bookId, bookId))).toEqual([]);
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
    const { bookId, scene } = await aScene();
    const turn = await addTurn(db, scene, 'character', 'I wave.');
    await db.transaction((tx) => remember(tx, writer(bookId, { turnId: turn.id }), 'The owner waves a lot.'));
    await db.delete(books).where(eq(books.id, bookId));
    const left = await db.select().from(changes).where(and(eq(changes.bookId, bookId)));
    expect(left).toEqual([]);
  });
});
