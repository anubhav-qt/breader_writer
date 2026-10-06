import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { books, characters, turns } from '../src/db/schema.ts';
import { headFor, instructionsFor } from '../src/procreator/brief.ts';
import { render } from '../src/prompts/render.ts';
import { readStory } from '../src/story/read.ts';
import { addTurn, setReply, turnsOf, type Scene, type Turn } from '../src/story/scenes.ts';
import { briefView, characterView, pageView, type BriefView } from '../src/story/view.ts';
import { deps } from './helpers.ts';
import { aBook, aPlayedStory, end, nextScene } from './stories.ts';

const db = deps.db;

/** The brief for a scene, as its session would open with it. */
async function briefOf(scene: Scene): Promise<BriefView> {
  const story = await readStory(db, scene.bookId);
  const before = story.scenes.find((each) => each.number === scene.number - 1);
  let lastScene: Turn[] = [];
  if (before) {
    lastScene = await turnsOf(db, before.id);
  }
  return briefView(story, scene, lastScene);
}

describe('the brief', () => {
  it('gives the people in the scene in full, the owner’s sheet and Procreator’s page, and everyone else in a line', async () => {
    const { second } = await aPlayedStory();
    const brief = await briefOf(second);
    expect(brief.present).toEqual([
      {
        name: 'Aiko',
        protagonist: true,
        sheet: { who: 'A lamplighter', personality: 'Stubborn, kind', past: '', notes: '' },
        about: '',
        page: 'Afraid of deep water since the flood.',
      },
      { name: 'Ren', protagonist: false, sheet: { who: 'The ferryman’s son', personality: '', past: '', notes: '' }, about: '', page: '' },
    ]);
    expect(brief.others).toEqual([{ name: 'Sora', protagonist: false, line: '' }]);
    expect(brief.scene).toEqual({ number: 2, place: 'The ferry', time: 'Dusk', present: ['Aiko', 'Ren'] });
  });

  it('gives the relationships between the people in the scene in full, and everyone else’s as their bond', async () => {
    const { second } = await aPlayedStory();
    const brief = await briefOf(second);
    expect(brief.close).toHaveLength(1);
    const [line] = brief.close;
    expect([line.a.name, line.b.name].sort()).toEqual(['Aiko', 'Ren']);
    expect(line.history).toEqual([{ scene: 1, text: 'Aiko forgives Ren for leaving.' }]);
    expect(brief.distant).toHaveLength(1);
    expect([brief.distant[0].a, brief.distant[0].b].sort()).toEqual(['Ren', 'Sora']);
    expect(brief.distant[0].bond).toBe('cousins');
  });

  it('holds the story so far, the Plan and Threads, and Procreator’s memory, its people as links', async () => {
    const { second } = await aPlayedStory();
    const brief = await briefOf(second);
    expect(brief.earlier).toEqual([
      { number: 1, place: 'The Lamp House, at the top of the stairs', time: 'Morning', summary: 'Aiko lit the first lamp, and Ren came to the door.' },
    ]);
    expect(brief.plan).toBe('[[Aiko]] crosses the river and learns who cut the rope.');
    expect(brief.threads).toBe('- Who cut the ferry rope?');
    expect(brief.memory).toEqual([{ id: brief.memory[0].id, text: 'The owner wants [[Ren]] kept likeable.' }]);
  });

  it('indexes every page but the characters’, and gives the scene’s place its page', async () => {
    const { first, second } = await aPlayedStory();
    const brief = await briefOf(second);
    expect(brief.index.map((entry) => `${entry.title} (${entry.kind})`)).toEqual([
      'The Lamp House (place)',
      'Plan (story)',
      'Threads (story)',
      'Timeline (story)',
    ]);
    expect(brief.places).toEqual([]);
    const atTheHouse = await briefOf(first);
    expect(atTheHouse.places).toEqual([
      {
        title: 'The Lamp House',
        kind: 'place',
        about: 'Where the city’s lamps are kept.',
        body: 'A narrow house of oil and wicks. [[Ren]] owes its keeper money.',
      },
    ]);
  });

  it('picks the story up from the whole scene before, word for word, without its taken back turns', async () => {
    const { bookId, aiko } = await aBook();
    const first = await nextScene(bookId, 'The ferry', [aiko.id]);
    const moves = ['I untie the boat.', 'I push off.', 'I sing.', 'I row.'];
    for (const move of moves) {
      const turn = await addTurn(db, first, 'character', move);
      await setReply(db, turn, `After: ${move}`);
    }
    const [, , sung] = await turnsOf(db, first.id);
    await db.update(turns).set({ undone: true }).where(eq(turns.id, sung.id));
    await end(bookId, first);
    const second = await nextScene(bookId, 'The far bank', [aiko.id]);

    const brief = await briefOf(second);
    expect(brief.lastScene?.number).toBe(1);
    expect(brief.lastScene?.turns.map((turn) => turn.input)).toEqual(['I untie the boat.', 'I push off.', 'I row.']);
    expect(brief.lastScene?.turns[2]).toEqual({ number: 4, voice: 'character', input: 'I row.', reply: 'After: I row.' });
  });

  it('works out where the story stands against its length', async () => {
    const { bookId, second } = await aPlayedStory();
    expect((await briefOf(second)).book.pacing).toBe('Scene 2 of about 15: the beginning. 0 of 30,000 words are written.');
    await db.update(books).set({ length: 'short_story', wordGoal: 8000, wordsWritten: 5000 }).where(eq(books.id, bookId));
    expect((await briefOf(second)).book.pacing).toBe('Scene 2 of about 4: the middle. 5,000 of 8,000 words are written.');
  });

  it('reaches every structured place at once when someone is renamed', async () => {
    const { ren, second } = await aPlayedStory();
    await db.update(characters).set({ name: 'Renji' }).where(eq(characters.id, ren.id));
    const brief = await briefOf(second);
    expect(brief.memory[0].text).toBe('The owner wants [[Renji]] kept likeable.');
    expect(brief.close[0].history[0].text).toBe('Aiko forgives Renji for leaving.');
    expect(brief.scene.present).toEqual(['Aiko', 'Renji']);
  });
});

describe('the brief in a session', () => {
  it('lays the brief out in the order the model reads it, each section with what it holds', async () => {
    const { second } = await aPlayedStory();
    const text = await headFor(db, second, '');
    const order = ['<book>', '<world>', '<story_so_far>', '<plan>', '<threads>', '<memory>', '<cast>', '<relationships>', '<last_scene ', '<reference_index>', '<this_scene'];
    const at = order.map((tag) => text.indexOf(tag));
    expect(at.every((index) => index >= 0)).toBe(true);
    expect([...at].sort((one, other) => one - other)).toEqual(at);

    expect(text).toContain('Length: a novella of about 30,000 words\nStyle: Conventional prose.');
    expect(text).toContain('<world>\nGenre: Fantasy\nSetting: A river city, winter\n</world>');
    expect(text).toContain(
      '<scene number="1" where="The Lamp House, at the top of the stairs" when="Morning">\nAiko lit the first lamp, and Ren came to the door.\n</scene>',
    );
    expect(text).toContain('<plan>\n[[Aiko]] crosses the river and learns who cut the rope.\n</plan>');
    expect(text).toMatch(/<memory>\n- \[\d+\] The owner wants \[\[Ren\]\] kept likeable\.\n<\/memory>/);
    expect(text).toContain(
      '<character name="Aiko" played_by="the owner">\n<sheet>\nWho: A lamplighter\nPersonality: Stubborn, kind\n</sheet>\n<page>\nAfraid of deep water since the flood.\n</page>\n</character>',
    );
    expect(text).toContain('<character name="Ren">\n<sheet>\nWho: The ferryman’s son\n</sheet>\n<page>\nNothing of yours yet.\n</page>\n</character>');
    expect(text).toContain('<character name="Sora"/>');
    expect(text).toContain('What Aiko hides from Ren: that she saw him at the docks');
    expect(text).toContain('How they got here:\n- Scene 1: Aiko forgives Ren for leaving.');
    expect(text).toMatch(/Between people not both in the scene, in short:\n- (Sora and Ren|Ren and Sora): cousins/);
    expect(text).toContain(
      '<last_scene number="1">\n<turn number="1">\n<move by="Aiko">I light the first lamp.</move>\n<reply>The wick catches. Ren is at the door.</reply>\n</turn>\n</last_scene>',
    );
    expect(text).toContain('- The Lamp House (place): Where the city’s lamps are kept.\n- Plan (story): Where the story is heading.');
    expect(text.endsWith('<this_scene number="2">\nWhere: The ferry\nWhen: Dusk\nPresent: Aiko, Ren\n</this_scene>')).toBe(true);
    expect(text).not.toContain('I ask Ren who cut the rope.');
    expect(text).not.toMatch(/\n\n\n/);
  });

  it('says what isn’t written yet, and leaves out what a first scene has nothing for', async () => {
    const book = await aBook();
    const scene = await nextScene(book.bookId, 'The ferry', [book.aiko.id]);
    const text = await headFor(db, scene, '');
    expect(text).toContain('<story_so_far>\nNothing yet: this is the first scene.\n</story_so_far>');
    expect(text).toContain('<plan>\nNot written yet.\n</plan>\n\n<threads>\nNot written yet.\n</threads>');
    expect(text).toContain('<memory>\nNothing yet.\n</memory>');
    expect(text).toContain('<reference_index>\nNo pages yet but the cast\'s.\n</reference_index>');
    expect(text).toContain('<character name="Ren">The ferryman’s son</character>');
    expect(text).not.toContain('<last_scene');
    expect(text).not.toContain('<scene_so_far>');
  });

  it('opens a segment after a compaction with the scene so far', async () => {
    const { second } = await aPlayedStory();
    const text = await headFor(db, second, 'Aiko asked Ren about the rope. He lied.');
    expect(text.endsWith('</this_scene>\n\n<scene_so_far>\nAiko asked Ren about the rope. He lied.\n</scene_so_far>\nThe scene goes on from here, word for word.')).toBe(true);
  });

  it('says a light novel’s style and point of view', async () => {
    const book = await aBook();
    await db.update(books).set({ length: 'light_novel', wordGoal: 50000, pov: 'first' }).where(eq(books.id, book.bookId));
    const scene = await nextScene(book.bookId, 'The ferry', []);
    const text = await headFor(db, scene, '');
    expect(text).toContain('Length: a light novel of about 50,000 words');
    expect(text).toContain('Style: Light novel: dialogue forward');
    expect(text).toContain('Point of view: First person, as the protagonist.');
  });

  it('fails on a missing value instead of leaving a hole', async () => {
    const { second } = await aPlayedStory();
    const brief = await briefOf(second);
    const broken = { ...brief, book: { ...brief.book, title: undefined }, summary: '' };
    expect(() => render('procreator/head.njk', broken)).toThrow('attempted to output null or undefined value');
  });

  it('shows a page as read_page gives it', async () => {
    const { bookId } = await aPlayedStory();
    const story = await readStory(db, bookId);
    const names = new Map(story.characters.map((person) => [person.id, person.name]));
    const aiko = story.characters[0];
    const page = story.pages.find((each) => each.characterId === aiko.id) ?? null;
    const person = render('procreator/read.njk', { person: characterView(aiko, page, names), page: null });
    expect(person).toBe(
      '<character name="Aiko" played_by="the owner">\n<sheet>\nWho: A lamplighter\nPersonality: Stubborn, kind\n</sheet>\n<page>\nAfraid of deep water since the flood.\n</page>\n</character>',
    );
    const house = story.pages.find((each) => each.title === 'The Lamp House');
    if (!house) {
      throw new Error('The Lamp House should have a page.');
    }
    const other = render('procreator/read.njk', { person: null, page: pageView(house, names) });
    expect(other).toBe(
      '<page title="The Lamp House" kind="place">\nAbout: Where the city’s lamps are kept.\n\nA narrow house of oil and wicks. [[Ren]] owes its keeper money.\n</page>',
    );
  });

  it('gives Procreator its instructions, naming who the owner plays', async () => {
    const { bookId } = await aBook();
    const text = await instructionsFor(db, bookId);
    expect(text.startsWith('You are Procreator. You run a story its owner lives inside: the owner plays Aiko,')).toBe(true);
    expect(text).toContain('write everyone in the cast as a link, [[Name]]');
    expect(text).not.toMatch(/\n\n\n/);
  });
});
