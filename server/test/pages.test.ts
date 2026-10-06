import { desc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { changes, characters, notes, pages } from '../src/db/schema.ts';
import { takeBack, versionsOf } from '../src/story/changes.ts';
import { forget, MAX_NOTES, NOTE_CHARS, notesOf, remember } from '../src/story/memory.ts';
import { Cast, linked, unlinked } from '../src/story/mentions.ts';
import { editPage, findPage, PAGE_CHARS, writePage, type PageWrite } from '../src/story/pages.ts';
import { searchStory } from '../src/story/search.ts';
import { deps } from './helpers.ts';
import { aBook, aPlayedStory, writer } from './stories.ts';

const db = deps.db;

function place(title: string, body: string, about = 'A place.'): PageWrite {
  return { title, kind: 'place', about, body };
}

async function write(bookId: string, page: PageWrite) {
  return db.transaction((tx) => writePage(tx, writer(bookId), page));
}

async function change(bookId: string, title: string, find: string, replace: string) {
  return db.transaction((tx) => editPage(tx, writer(bookId), { title, find, replace }));
}

async function changesOf(bookId: string) {
  return db.select().from(changes).where(eq(changes.bookId, bookId)).orderBy(desc(changes.id));
}

describe('links', () => {
  const cast = new Cast([
    { id: '11111111-1111-4111-8111-111111111111', name: 'Aiko' },
    { id: '22222222-2222-4222-8222-222222222222', name: 'Ren Takeda' },
    { id: '33333333-3333-4333-8333-333333333333', name: 'Kai' },
    { id: '44444444-4444-4444-8444-444444444444', name: 'kai' },
  ]);
  const names = new Map([
    ['11111111-1111-4111-8111-111111111111', 'Aiko'],
    ['22222222-2222-4222-8222-222222222222', 'Ren Takeda'],
  ]);

  it('keeps a link to someone in the cast as a mention, in any case and spacing, and shows it with their name as it is', () => {
    const kept = unlinked('[[aiko]] meets [[ Ren  Takeda ]] at the docks.', cast);
    expect(kept).toBe('<@11111111-1111-4111-8111-111111111111> meets <@22222222-2222-4222-8222-222222222222> at the docks.');
    expect(linked(kept, names)).toBe('[[Aiko]] meets [[Ren Takeda]] at the docks.');
    const renamed = new Map([...names, ['11111111-1111-4111-8111-111111111111', 'Aiko Mori']]);
    expect(linked(kept, renamed)).toBe('[[Aiko Mori]] meets [[Ren Takeda]] at the docks.');
  });

  it('turns away a link to no one in the cast, or to a name two people share', () => {
    expect(() => unlinked('[[The Keep]] stands empty.', cast)).toThrow('No one in the cast is called The Keep.');
    expect(() => unlinked('[[Kai]] waves.', cast)).toThrow('More than one person in the cast is called Kai');
  });

  it('shows someone who has left the cast plainly', () => {
    expect(linked('<@99999999-9999-4999-8999-999999999999> left.', names)).toBe('someone no longer in the cast left.');
  });
});

describe('pages', () => {
  it('makes a page, keeps its people as mentions, and reads it back with links', async () => {
    const { bookId, ren } = await aBook();
    const made = await write(bookId, place('The Keep', 'Held by [[Ren]] since the siege.', 'The old fortress.'));
    expect(made.outcome).toBe('made');
    expect(made.page).toMatchObject({ kind: 'place', title: 'The Keep', about: 'The old fortress.', body: `Held by <@${ren.id}> since the siege.`, characterId: null });

    const found = await findPage(db, bookId, '  the   keep ');
    expect(found.page?.id).toBe(made.page.id);
    expect(found.character).toBeNull();
  });

  it('replaces a page whole, keeps the version before, and changes nothing when it says the same', async () => {
    const { bookId } = await aBook();
    await write(bookId, place('The Keep', 'Empty.'));
    const rewritten = await write(bookId, place('The Keep', 'Held again.', 'The old fortress, retaken.'));
    expect(rewritten.outcome).toBe('changed');
    const [latest] = await changesOf(bookId);
    expect(latest.what).toBe('Rewrote the page The Keep');
    const [version] = await versionsOf(db, latest.id);
    expect(version.before).toEqual({ about: 'A place.', body: 'Empty.' });

    const again = await write(bookId, place('The Keep', 'Held again.', 'The old fortress, retaken.'));
    expect(again.outcome).toBe('unchanged');
    expect(await changesOf(bookId)).toHaveLength(2);
  });

  it('turns away a page it can’t keep, saying how to fix it', async () => {
    const { bookId } = await aBook();
    await expect(write(bookId, place('', 'Something.'))).rejects.toThrow('The page needs a title.');
    await expect(write(bookId, place('[[Keep]]', 'Something.'))).rejects.toThrow('Write the title without brackets.');
    await expect(write(bookId, place('The Keep', '   '))).rejects.toThrow('The page is empty.');
    await expect(write(bookId, place('The Keep', 'Something.', ''))).rejects.toThrow('Say in one line what the page holds');
    await expect(write(bookId, place('The Keep', 'x'.repeat(PAGE_CHARS + 1)))).rejects.toThrow('Split it into pages on narrower subjects.');
    await expect(write(bookId, place('The Keep', 'Held by [[Tobin]].'))).rejects.toThrow('No one in the cast is called Tobin.');
    await expect(write(bookId, { title: 'Tobin', kind: 'character', about: '', body: 'A stranger.' })).rejects.toThrow(
      'No one in the cast is called Tobin. A character page is for someone in the cast',
    );
    await expect(write(bookId, place('Ren', 'A town.'))).rejects.toThrow('Ren is in the cast, so the page called Ren is theirs');
    expect(await db.select().from(pages).where(eq(pages.bookId, bookId))).toEqual([]);
  });

  it('gives someone in the cast their page under their name, with nothing of the owner’s sheet in it', async () => {
    const { bookId, aiko } = await aBook();
    const made = await write(bookId, { title: 'aiko', kind: 'character', about: '', body: 'Afraid of deep water.' });
    expect(made.page).toMatchObject({ kind: 'character', characterId: aiko.id, title: '', about: '', body: 'Afraid of deep water.' });
    const [latest] = await changesOf(bookId);
    expect(latest.what).toBe('Wrote Aiko\'s page');

    const found = await findPage(db, bookId, 'Aiko');
    expect(found.character?.who).toBe('A lamplighter');
    expect(found.page?.id).toBe(made.page.id);
  });

  it('edits part of a page, once, and says how when the text isn’t there once', async () => {
    const { bookId } = await aBook();
    await write(bookId, place('The Keep', 'Held by [[Ren]]. The gate is red. The door is red.'));
    const edited = await change(bookId, 'The Keep', 'Held by [[Ren]].', 'Held by [[Sora]], who took it from [[Ren]].');
    expect(edited.outcome).toBe('changed');
    const [latest] = await changesOf(bookId);
    expect(latest.what).toBe('Changed the page The Keep');

    await expect(change(bookId, 'The Keep', 'The tower', 'x')).rejects.toThrow('That text isn\'t on the page.');
    await expect(change(bookId, 'The Keep', 'is red.', 'is blue.')).rejects.toThrow('That text is on the page more than once.');
    await expect(change(bookId, 'The Hall', 'x', 'y')).rejects.toThrow('There\'s no page called The Hall.');

    const found = await findPage(db, bookId, 'The Keep');
    const names = new Map(found.cast.map((person) => [person.id, person.name]));
    expect(linked(found.page?.body ?? '', names)).toBe('Held by [[Sora]], who took it from [[Ren]]. The gate is red. The door is red.');
  });

  it('adds to the end of a page, once, however often the same addition is sent', async () => {
    const { bookId } = await aBook();
    await write(bookId, place('The Keep', 'Empty.'));
    const added = await change(bookId, 'The Keep', '', '  Ren hides there now.  ');
    expect(added.page.body).toBe('Empty.\n\nRen hides there now.');
    const again = await change(bookId, 'The Keep', '', 'Ren hides there now.');
    expect(again.outcome).toBe('unchanged');
    await expect(change(bookId, 'The Keep', '', '  ')).rejects.toThrow('There is nothing to add.');
  });

  it('adds to a character’s page, making it the first time, and never reaches the owner’s sheet', async () => {
    const { bookId, aiko } = await aBook();
    const made = await change(bookId, 'Aiko', '', 'Afraid of deep water since the flood.');
    expect(made.outcome).toBe('made');
    await expect(change(bookId, 'Ren', 'The ferryman', 'The baker')).rejects.toThrow('Ren\'s page has nothing of yours yet.');
    await expect(change(bookId, 'Aiko', 'A lamplighter', 'A baker')).rejects.toThrow('the sheet above it is the owner\'s');
    const [sheet] = await db.select().from(characters).where(eq(characters.id, aiko.id));
    expect(sheet.who).toBe('A lamplighter');
  });

  it('reads a renamed person by their new name, so an edit has to use it too', async () => {
    const { bookId, ren } = await aBook();
    await write(bookId, place('The Keep', 'Held by [[Ren]].'));
    await db.update(characters).set({ name: 'Renji' }).where(eq(characters.id, ren.id));
    await expect(change(bookId, 'The Keep', 'Held by [[Ren]].', 'x')).rejects.toThrow('That text isn\'t on the page.');
    const edited = await change(bookId, 'The Keep', 'Held by [[Renji]].', 'Held by [[Renji]] alone.');
    expect(edited.page.body).toBe(`Held by <@${ren.id}> alone.`);
  });

  it('takes a page write back with its change', async () => {
    const { bookId } = await aBook();
    await write(bookId, place('The Keep', 'Empty.'));
    await change(bookId, 'The Keep', 'Empty.', 'Full.');
    const [latest] = await changesOf(bookId);
    await db.transaction((tx) => takeBack(tx, latest.id, { turnId: null, by: 'owner' }));
    const found = await findPage(db, bookId, 'The Keep');
    expect(found.page?.body).toBe('Empty.');
  });
});

describe('memory', () => {
  it('keeps a note with its people as mentions, and the same note once', async () => {
    const { bookId, ren } = await aBook();
    const first = await db.transaction((tx) => remember(tx, writer(bookId), '  The owner wants [[Ren]]\n kept likeable. '));
    expect(first.made).toBe(true);
    expect(first.note.text).toBe(`The owner wants <@${ren.id}> kept likeable.`);
    const again = await db.transaction((tx) => remember(tx, writer(bookId), 'the owner wants [[ren]] kept likeable.'));
    expect(again).toEqual({ note: first.note, made: false });
    expect(await notesOf(db, bookId)).toHaveLength(1);
  });

  it('turns away a note that is empty, too long, or past what memory holds', async () => {
    const { bookId } = await aBook();
    await expect(db.transaction((tx) => remember(tx, writer(bookId), ' '))).rejects.toThrow('The note is empty.');
    await expect(db.transaction((tx) => remember(tx, writer(bookId), 'x'.repeat(NOTE_CHARS + 1)))).rejects.toThrow(
      `A note is at most ${NOTE_CHARS} characters`,
    );
    for (let i = 0; i < MAX_NOTES; i += 1) {
      await db.insert(notes).values({ bookId, text: `Note ${i}` });
    }
    await expect(db.transaction((tx) => remember(tx, writer(bookId), 'One more.'))).rejects.toThrow('Your memory is full');
  });

  it('forgets a note of the book’s, as a change that can be taken back', async () => {
    const { bookId } = await aBook();
    const other = await aBook();
    const kept = await db.transaction((tx) => remember(tx, writer(bookId), 'Short chapters.'));
    const elsewhere = await db.transaction((tx) => remember(tx, writer(other.bookId), 'Long chapters.'));
    await expect(db.transaction((tx) => forget(tx, writer(bookId), elsewhere.note.id))).rejects.toThrow(
      `There's no note ${elsewhere.note.id} in your memory.`,
    );
    await db.transaction((tx) => forget(tx, writer(bookId), kept.note.id));
    expect(await notesOf(db, bookId)).toEqual([]);
    const [latest] = await changesOf(bookId);
    expect(latest.what).toBe(`Forgot note ${kept.note.id}`);
    await db.transaction((tx) => takeBack(tx, latest.id, { turnId: null, by: 'owner' }));
    expect(await notesOf(db, bookId)).toEqual([kept.note]);
  });
});

describe('search', () => {
  it('finds exact words in pages, summaries and standing turns, in any case and across line breaks', async () => {
    const { bookId } = await aPlayedStory();
    const rope = await searchStory(db, bookId, 'CUT THE');
    expect(rope.matches.map((match) => match.where)).toEqual([
      'Plan, a page',
      'Threads, a page',
      'Scene 2, turn 2, the owner\'s move',
    ]);
    expect(rope.matches[2].text).toBe('I ask Ren who cut the rope.');

    const owes = await searchStory(db, bookId, '[[Ren]] owes');
    expect(owes.matches).toEqual([{ where: 'The Lamp House, a page', text: 'The Lamp House Where the city’s lamps are kept. A narrow house of oil and wicks. [[Ren]] owes its keeper money.' }]);

    const lamp = await searchStory(db, bookId, 'first lamp');
    expect(lamp.matches.map((match) => match.where)).toEqual(['Scene 1, its summary', 'Scene 1, turn 1, the owner\'s move']);

    expect((await searchStory(db, bookId, 'I jump')).matches).toEqual([]);
    expect((await searchStory(db, bookId, 'river rise')).matches[0].where).toBe('Scene 2, turn 3, the owner\'s author note');
    expect((await searchStory(db, bookId, 'deep\n   water')).matches[0].where).toBe('Aiko\'s page');
  });

  it('gives a dozen matches and says how many more there are', async () => {
    const { bookId } = await aBook();
    for (let i = 0; i < 15; i += 1) {
      await write(bookId, place(`Room ${i}`, 'A cold room.'));
    }
    const recall = await searchStory(db, bookId, 'cold room');
    expect(recall.matches).toHaveLength(12);
    expect(recall.more).toBe(3);
    await expect(searchStory(db, bookId, ' ')).rejects.toThrow('Say what words to look for.');
  });
});
