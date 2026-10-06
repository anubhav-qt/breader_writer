import { SCENE_WORDS, type Darkness, type Length, type Pov } from '@writer/shared/book';
import { namesOf } from './cast.ts';
import { linked, named } from './mentions.ts';
import { PAGE_KINDS, PLAN, THREADS, type Page } from './pages.ts';
import type { BookRow, CharacterRow, RelationshipRow, Story } from './read.ts';
import type { HistoryEntry } from './relationships.ts';
import type { Scene, Turn, Voice } from './scenes.ts';

/*
 * The story as Procreator's templates take it (src/prompts/templates/): the brief a scene's session
 * opens with, and a page as read_page shows it. Every mention gets its name: as a link, [[Name]],
 * in what Procreator writes (pages, memory), and plainly elsewhere. Scenes go by number, the
 * people in the scene come in full and everyone else in a line. All the logic is here; the
 * templates only lay it out.
 */

/** A book's settings, as the prompts give them. */
export interface SettingsView {
  /** Its length and goal ("a novella of about 30,000 words"). */
  length: string;
  style: string;
  pov: string;
  darkness: string;
}

export interface BookView extends SettingsView {
  title: string;
  /** Where the story stands against its length. */
  pacing: string;
}

export interface WorldView {
  genre: string;
  tone: string;
  setting: string;
  rules: string;
  notes: string;
}

/** An earlier scene, as the story so far holds it. */
export interface SummaryView {
  number: number;
  place: string;
  time: string;
  summary: string;
}

export interface NoteView {
  id: number;
  text: string;
}

/** The owner's sheet: theirs, and only theirs to change. */
export interface SheetView {
  who: string;
  personality: string;
  past: string;
  notes: string;
}

/** Someone in full: the owner's sheet, and Procreator's page below it. */
export interface CharacterView {
  name: string;
  /** The one the owner plays. */
  protagonist: boolean;
  sheet: SheetView;
  about: string;
  /** Procreator's page, or empty while it has written nothing. */
  page: string;
}

/** Someone in a line. */
export interface OtherView {
  name: string;
  protagonist: boolean;
  line: string;
}

/** Something the story kept, and the scene it came from (null: before the story began). */
export interface Dated {
  scene: number | null;
  text: string;
}

export interface SideView {
  name: string;
  sees: string;
  hides: string;
}

/** A relationship in full: the bond, both sides and how they got here. */
export interface RelationshipView {
  bond: string;
  a: SideView;
  b: SideView;
  history: Dated[];
}

/** A relationship in short: who, and the bond. */
export interface BondView {
  a: string;
  b: string;
  bond: string;
}

/** A page that isn't a character's. */
export interface PageView {
  title: string;
  kind: string;
  about: string;
  body: string;
}

export interface IndexEntry {
  title: string;
  kind: string;
  about: string;
}

export interface TurnView {
  number: number;
  voice: Voice;
  input: string;
  reply: string;
}

/** The scene before, word for word. */
export interface LastSceneView {
  number: number;
  turns: TurnView[];
}

/** The scene the session plays. */
export interface SceneView {
  number: number;
  place: string;
  time: string;
  present: string[];
}

export interface BriefView {
  protagonist: string;
  book: BookView;
  world: WorldView;
  /** Every scene before this one, with its summary. */
  earlier: SummaryView[];
  /** The Plan page, or empty. */
  plan: string;
  /** The Threads page, or empty. */
  threads: string;
  memory: NoteView[];
  /** The people in the scene, in cast order. */
  present: CharacterView[];
  /** Everyone else. */
  others: OtherView[];
  /** Between people who are both in the scene. */
  close: RelationshipView[];
  /** Everyone else's. */
  distant: BondView[];
  /** The pages of places the scene's place names. */
  places: PageView[];
  lastScene: LastSceneView | null;
  /** Every page but the characters', which the cast covers. */
  index: IndexEntry[];
  scene: SceneView;
}

const LENGTH_NAMES: Record<Length, string> = {
  short_story: 'a short story',
  novella: 'a novella',
  light_novel: 'a light novel',
  novel: 'a novel',
};

const CONVENTIONAL = 'Conventional prose.';
const LIGHT_NOVEL =
  'Light novel: dialogue forward, short paragraphs, plenty of the protagonist’s inner voice, brisk pacing, and short chapters with long descriptive titles.';

const POV_NAMES: Record<Pov, string> = {
  third_close: 'Third person, close on the protagonist.',
  first: 'First person, as the protagonist.',
  third_omniscient: 'Third person, omniscient.',
};

const DARKNESS_NAMES: Record<Darkness, string> = {
  gentle: 'Gentle: fit for all ages. Danger and sadness, but nothing graphic.',
  mature:
    'Mature: violence, grief, cruelty and romance as a mainstream adult novel has them, on the page but not lingered over.',
  unflinching: 'Unflinching: whatever the story needs, shown as plainly as it needs.',
};

function words(count: number): string {
  return count.toLocaleString('en-US');
}

/** Where the story is against its length, from the scene being played. */
function pacingOf(book: BookRow, number: number): string {
  const about = Math.max(1, Math.round(book.wordGoal / SCENE_WORDS));
  const share = number / about;
  let part = 'the beginning';
  if (share > 1) {
    part = 'past its planned length, so bring it to its ending';
  } else if (share > 0.75) {
    part = 'the end';
  } else if (share > 0.25) {
    part = 'the middle';
  }
  const written = `${words(book.wordsWritten)} of ${words(book.wordGoal)} words are written.`;
  return `Scene ${number} of about ${about}: ${part}. ${written}`;
}

/** A book's settings, as the prompts give them: its length and style, point of view and how dark it goes. */
export function settingsView(length: Length, wordGoal: number, pov: Pov, darkness: Darkness): SettingsView {
  let style = CONVENTIONAL;
  if (length === 'light_novel') {
    style = LIGHT_NOVEL;
  }
  return {
    length: `${LENGTH_NAMES[length]} of about ${words(wordGoal)} words`,
    style,
    pov: POV_NAMES[pov],
    darkness: DARKNESS_NAMES[darkness],
  };
}

function bookView(book: BookRow, number: number): BookView {
  const settings = settingsView(book.length as Length, book.wordGoal, book.pov as Pov, book.darkness as Darkness);
  return { title: book.title, ...settings, pacing: pacingOf(book, number) };
}

/** Someone in full, as the brief and read_page show them. */
export function characterView(character: CharacterRow, page: Page | null, names: Map<string, string>): CharacterView {
  let about = '';
  let body = '';
  if (page) {
    about = page.about;
    body = linked(page.body, names);
  }
  return {
    name: character.name,
    protagonist: character.role === 'protagonist',
    sheet: { who: character.who, personality: character.personality, past: character.past, notes: character.notes },
    about,
    page: body,
  };
}

/** A page that isn't a character's, as the brief and read_page show it. */
export function pageView(page: Page, names: Map<string, string>): PageView {
  return { title: page.title, kind: page.kind, about: page.about, body: linked(page.body, names) };
}

/** Every page but the characters', by kind, then title. */
export function indexOf(pages: Page[]): IndexEntry[] {
  const others = pages.filter((page) => page.characterId === null);
  const kinds: readonly string[] = PAGE_KINDS;
  others.sort((one, other) => {
    const byKind = kinds.indexOf(one.kind) - kinds.indexOf(other.kind);
    if (byKind !== 0) {
      return byKind;
    }
    return one.title.localeCompare(other.title);
  });
  return others.map((page) => ({ title: page.title, kind: page.kind, about: page.about }));
}

/** A story page's text, or empty while it hasn't been written. */
function storyPage(story: Story, title: string, names: Map<string, string>): string {
  const page = story.pages.find((each) => each.characterId === null && each.title.toLowerCase() === title.toLowerCase());
  if (!page) {
    return '';
  }
  return linked(page.body, names);
}

/** Who is in the scene: everyone it lists, and always the protagonist. */
function presentIn(story: Story, scene: Scene): Set<string> {
  const present = new Set<string>(scene.present);
  for (const character of story.characters) {
    if (character.role === 'protagonist') {
      present.add(character.id);
    }
  }
  return present;
}

/** The pages of the places the scene's place names ("The Keep's great hall" names The Keep). */
function placesIn(story: Story, scene: Scene, names: Map<string, string>): PageView[] {
  const where = scene.place.toLowerCase();
  const places = story.pages.filter((page) => page.kind === 'place' && page.title !== '' && where.includes(page.title.toLowerCase()));
  places.sort((one, other) => one.title.localeCompare(other.title));
  return places.map((page) => pageView(page, names));
}

/** A history entry, named, with the number of the scene it came from. */
function dated(entry: HistoryEntry, names: Map<string, string>, numbers: Map<string, number>): Dated {
  let scene: number | null = null;
  if (entry.sceneId !== null) {
    scene = numbers.get(entry.sceneId) ?? null;
  }
  return { scene, text: named(entry.text, names) };
}

function relationshipView(line: RelationshipRow, story: Story, names: Map<string, string>, numbers: Map<string, number>): RelationshipView {
  const history = story.history.filter((entry) => entry.aId === line.aId && entry.bId === line.bId);
  return {
    bond: line.bond,
    a: { name: named(`<@${line.aId}>`, names), sees: line.aSees, hides: line.aHides },
    b: { name: named(`<@${line.bId}>`, names), sees: line.bSees, hides: line.bHides },
    history: history.map((entry) => dated(entry, names, numbers)),
  };
}

function turnView(turn: Turn): TurnView {
  return { number: turn.number, voice: turn.voice as Voice, input: turn.input, reply: turn.reply };
}

/**
 * The brief for a scene's session, from the story as it stands. `lastScene` is the scene before's
 * standing turns, word for word, for picking the story up where it left off.
 */
export function briefView(story: Story, scene: Scene, lastScene: Turn[]): BriefView {
  const names = namesOf(story.characters);
  const numbers = new Map<string, number>();
  for (const each of story.scenes) {
    numbers.set(each.id, each.number);
  }
  const present = presentIn(story, scene);

  const inScene: CharacterView[] = [];
  const others: OtherView[] = [];
  for (const character of story.characters) {
    const page = story.pages.find((each) => each.characterId === character.id) ?? null;
    if (present.has(character.id)) {
      inScene.push(characterView(character, page, names));
      continue;
    }
    let line = character.who;
    if (!line && page) {
      line = page.about;
    }
    others.push({ name: character.name, protagonist: character.role === 'protagonist', line });
  }

  const close: RelationshipView[] = [];
  const distant: BondView[] = [];
  for (const line of story.relationships) {
    if (present.has(line.aId) && present.has(line.bId)) {
      close.push(relationshipView(line, story, names, numbers));
    } else {
      distant.push({ a: named(`<@${line.aId}>`, names), b: named(`<@${line.bId}>`, names), bond: line.bond });
    }
  }

  const earlier = story.scenes.filter((each) => each.number < scene.number);
  let lastSceneView: LastSceneView | null = null;
  if (lastScene.length > 0) {
    lastSceneView = { number: scene.number - 1, turns: lastScene.map(turnView) };
  }
  const protagonist = story.characters.find((character) => character.role === 'protagonist');

  return {
    protagonist: protagonist?.name ?? '',
    book: bookView(story.book, scene.number),
    world: {
      genre: story.world?.genre ?? '',
      tone: story.world?.tone ?? '',
      setting: story.world?.setting ?? '',
      rules: story.world?.rules ?? '',
      notes: story.world?.notes ?? '',
    },
    earlier: earlier.map((each) => ({ number: each.number, place: each.place, time: each.time, summary: each.summary })),
    plan: storyPage(story, PLAN, names),
    threads: storyPage(story, THREADS, names),
    memory: story.notes.map((note) => ({ id: note.id, text: linked(note.text, names) })),
    present: inScene,
    others,
    close,
    distant,
    places: placesIn(story, scene, names),
    lastScene: lastSceneView,
    index: indexOf(story.pages),
    scene: {
      number: scene.number,
      place: scene.place,
      time: scene.time,
      present: inScene.map((character) => character.name),
    },
  };
}
