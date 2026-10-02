import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { books, characters } from '../src/db/schema.ts';
import { render } from '../src/prompts/render.ts';
import { startChange } from '../src/story/changes.ts';
import { readStory } from '../src/story/read.ts';
import { endScene } from '../src/story/scenes.ts';
import { storyView } from '../src/story/view.ts';
import { deps } from './helpers.ts';
import { aBook, aPlayedStory, tag } from './stories.ts';

const db = deps.db;

async function viewOf(bookId: string) {
  return storyView(await readStory(db, bookId));
}

describe('the story view', () => {
  it('names everyone the story mentions, and says which scene each thing came from', async () => {
    const { bookId } = await aPlayedStory();
    const view = await viewOf(bookId);
    expect(view.facts).toEqual([
      { scene: null, text: 'Ren owes the guild money.' },
      { scene: 1, text: 'Aiko can’t swim.' },
    ]);
    expect(view.arc).toBe('Aiko crosses the river and learns who cut the rope.');
    expect(view.cast[0]).toMatchObject({ name: 'Aiko', protagonist: true, growth: [{ scene: 1, text: 'Afraid of deep water since the flood.' }] });
    expect(view.timeline).toEqual([
      { scene: null, when: 'Twenty years before', what: 'The flood took the old bridge.' },
      { scene: 2, when: 'Dusk', what: 'They cross.' },
    ]);
  });

  it('gives the relationships of the people in the scene in full, and everyone else’s in short', async () => {
    const { bookId } = await aPlayedStory();
    const view = await viewOf(bookId);
    expect(view.close).toHaveLength(1);
    const [line] = view.close;
    const names = [line.a.name, line.b.name].sort();
    expect(names).toEqual(['Aiko', 'Ren']);
    expect(line.history).toEqual([{ scene: 1, text: 'Aiko forgives Ren for leaving.' }]);
    expect(view.distant).toHaveLength(1);
    expect([view.distant[0].a, view.distant[0].b].sort()).toEqual(['Ren', 'Sora']);
    expect(view.distant[0].bond).toBe('cousins');
  });

  it('keeps only the open threads', async () => {
    const { bookId } = await aPlayedStory();
    const view = await viewOf(bookId);
    expect(view.threads.map((thread) => thread.text)).toEqual(['Who cut the ferry rope?']);
  });

  it('gives the scene being played its standing turns, and earlier scenes their summaries', async () => {
    const { bookId } = await aPlayedStory();
    const view = await viewOf(bookId);
    expect(view.scene).toMatchObject({ number: 2, place: 'The ferry', present: ['Aiko', 'Ren'], summary: '' });
    expect(view.scene?.turns.map((turn) => turn.number)).toEqual([2, 3]);
    expect(view.earlier).toHaveLength(1);
    expect(view.earlier[0]).toMatchObject({ number: 1, summary: 'Aiko lit the first lamp, and Ren came to the door.', turns: [] });
  });

  it('keeps an ended scene’s turns word for word until they’re folded', async () => {
    const { bookId, second } = await aPlayedStory();
    await db.transaction(async (tx) => {
      const change = await startChange(tx, tag(bookId));
      await endScene(tx, change, second);
    });
    const view = await viewOf(bookId);
    expect(view.scene).toBeNull();
    expect(view.earlier[1].turns.map((turn) => turn.input)).toEqual(['I ask Ren who cut the rope.', 'Make the river rise.']);
  });

  it('works out where the story stands against its length', async () => {
    const { bookId } = await aPlayedStory();
    const view = await viewOf(bookId);
    expect(view.pacing).toBe('Scene 2 of about 15: the beginning. 0 of 30,000 words are written.');

    await db.update(books).set({ length: 'short_story', wordGoal: 8000, wordsWritten: 5000 }).where(eq(books.id, bookId));
    const shorter = await viewOf(bookId);
    expect(shorter.pacing).toBe('Scene 2 of about 4: the middle. 5,000 of 8,000 words are written.');
  });

  it('reaches every structured place at once when someone is renamed', async () => {
    const { bookId, ren } = await aPlayedStory();
    await db.update(characters).set({ name: 'Renji' }).where(eq(characters.id, ren.id));
    const view = await viewOf(bookId);
    expect(view.facts[0].text).toBe('Renji owes the guild money.');
    expect(view.close[0].history[0].text).toBe('Aiko forgives Renji for leaving.');
    expect(view.scene?.present).toEqual(['Aiko', 'Renji']);
  });
});

describe('the story in a prompt', () => {
  it('lays out each section with what it holds', async () => {
    const { bookId } = await aPlayedStory();
    const text = render('partials/story.njk', { story: await viewOf(bookId) });
    expect(text).toContain('Length: a novella of about 30,000 words');
    expect(text).toContain('Style: Conventional prose.');
    expect(text).toContain('<world>\nGenre: Fantasy\nSetting: A river city, winter\n</world>');
    expect(text).toContain('<character name="Aiko" played_by="the owner">\nWho: A lamplighter\nPersonality: Stubborn, kind\nGrown over the story:\n- Scene 1: Afraid of deep water since the flood.\n</character>');
    expect(text).toContain('What Aiko hides from Ren: that she saw him at the docks');
    expect(text).toContain('How they got here:\n- Scene 1: Aiko forgives Ren for leaving.');
    expect(text).toMatch(/Between people not in the scene, in short:\n- (Sora and Ren|Ren and Sora): cousins/);
    expect(text).toContain('<arc>\nAiko crosses the river and learns who cut the rope.\n</arc>');
    expect(text).toMatch(/- Thread \d+, opened in scene 1: Who cut the ferry rope\?/);
    expect(text).toContain('- Before the story: Ren owes the guild money.\n- Scene 1: Aiko can’t swim.');
    expect(text).toContain('- Twenty years before (Before the story): The flood took the old bridge.');
    expect(text).toContain('<summary>\nAiko lit the first lamp, and Ren came to the door.\n</summary>\n</scene>\n</earlier_scenes>');
  });

  it('leaves out what’s closed or folded, and the scene being played', async () => {
    const { bookId } = await aPlayedStory();
    const text = render('partials/story.njk', { story: await viewOf(bookId) });
    expect(text).not.toContain('The unopened letter.');
    expect(text).not.toContain('I light the first lamp.');
    expect(text).not.toContain('I ask Ren who cut the rope.');
    expect(text).not.toMatch(/\n\n\n/);
  });

  it('writes an ended scene’s unfolded turns, the author’s notes as notes', async () => {
    const { bookId, second } = await aPlayedStory();
    await db.transaction(async (tx) => {
      const change = await startChange(tx, tag(bookId));
      await endScene(tx, change, second);
    });
    const text = render('partials/story.njk', { story: await viewOf(bookId) });
    expect(text).toContain(
      '<turn number="2">\n<move by="Aiko">I ask Ren who cut the rope.</move>\n<reply>"Not me," Ren says, too quickly.</reply>\n</turn>\n' +
        '<turn number="3">\n<author_note>Make the river rise.</author_note>\n<reply>The water climbs the hull.</reply>\n</turn>\n</scene>',
    );
    expect(text).not.toContain('I jump.');
  });

  it('leaves out the sections a new book has nothing in', async () => {
    const { bookId } = await aBook();
    const text = render('partials/story.njk', { story: await viewOf(bookId) });
    expect(text).toContain('<cast>');
    expect(text).toContain('<relationships>');
    for (const section of ['<arc>', '<open_threads>', '<facts>', '<timeline>', '<earlier_scenes>']) {
      expect(text).not.toContain(section);
    }
  });

  it('says a light novel’s style', async () => {
    const { bookId } = await aBook();
    await db.update(books).set({ length: 'light_novel', wordGoal: 50000, pov: 'first' }).where(eq(books.id, bookId));
    const text = render('partials/story.njk', { story: await viewOf(bookId) });
    expect(text).toContain('Length: a light novel of about 50,000 words');
    expect(text).toContain('Style: Light novel: dialogue forward');
    expect(text).toContain('Point of view: First person, as the protagonist.');
  });

  it('fails on a missing value instead of leaving a hole', async () => {
    const { bookId } = await aBook();
    const view = await viewOf(bookId);
    const broken = { ...view, title: undefined };
    expect(() => render('partials/story.njk', { story: broken })).toThrow('attempted to output null or undefined value');
  });
});
