import { SCENE_WORDS, type Darkness, type Length, type Pov } from '@writer/shared/book';
import { named } from './mentions.ts';
import type { CharacterRow, RelationshipRow, SceneState, Story } from './read.ts';
import type { Voice } from './scenes.ts';

/*
 * The story as the prompt templates take it (src/prompts/templates/): names filled in for every
 * <@id>, scenes by number, the relationships of the people in the scene in full and everyone
 * else's in short, and the pacing worked out. All the logic is here; the templates only lay it out.
 */

/** Something the story kept, and the scene it came from (null: before the story began). */
export interface Dated {
  scene: number | null;
  text: string;
}

export interface CharacterView {
  name: string;
  /** The one the owner plays. */
  protagonist: boolean;
  who: string;
  personality: string;
  past: string;
  notes: string;
  /** What the story has added to the sheet, oldest first. */
  growth: Dated[];
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

export interface ThreadView {
  id: number;
  text: string;
  opened: number | null;
}

export interface EventView {
  scene: number | null;
  when: string;
  what: string;
}

export interface TurnView {
  number: number;
  voice: Voice;
  input: string;
  reply: string;
}

export interface SceneView {
  number: number;
  place: string;
  time: string;
  present: string[];
  /** What the turns folded so far said. Whole, once the scene has ended and folded. */
  summary: string;
  /** Its turns not folded yet, word for word. */
  turns: TurnView[];
}

export interface WorldView {
  genre: string;
  tone: string;
  setting: string;
  rules: string;
  notes: string;
}

export interface StoryView {
  title: string;
  protagonist: string;
  /** Its length and goal ("a novella of about 30,000 words"). */
  length: string;
  style: string;
  pov: string;
  darkness: string;
  pacing: string;
  world: WorldView;
  cast: CharacterView[];
  /** Between people who are both in the scene. */
  close: RelationshipView[];
  /** Everyone else's. */
  distant: BondView[];
  arc: string;
  /** Open ones only. */
  threads: ThreadView[];
  facts: Dated[];
  timeline: EventView[];
  /** Every scene that has ended, in order. */
  earlier: SceneView[];
  /** The scene being played, or null between scenes. */
  scene: SceneView | null;
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

/** Where the story is against its length, from the scene it's on. */
function pacingOf(story: Story): string {
  const { book } = story;
  const about = Math.max(1, Math.round(book.wordGoal / SCENE_WORDS));
  const ended = story.scenes.filter((state) => state.scene.status === 'ended').length;
  const current = ended + 1;
  const share = current / about;
  let part = 'the beginning';
  if (share > 1) {
    part = 'past its planned length, so bring it to its ending';
  } else if (share > 0.75) {
    part = 'the end';
  } else if (share > 0.25) {
    part = 'the middle';
  }
  const written = `${words(book.wordsWritten)} of ${words(book.wordGoal)} words are written.`;
  return `Scene ${current} of about ${about}: ${part}. ${written}`;
}

function namesOf(story: Story): Map<string, string> {
  const names = new Map<string, string>();
  for (const character of story.characters) {
    names.set(character.id, character.name);
  }
  return names;
}

function sceneNumbers(story: Story): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const { scene } of story.scenes) {
    numbers.set(scene.id, scene.number);
  }
  return numbers;
}

/** Turns the story's rows into what the templates take. */
class Viewer {
  private readonly names: Map<string, string>;
  private readonly numbers: Map<string, number>;

  constructor(story: Story) {
    this.names = namesOf(story);
    this.numbers = sceneNumbers(story);
  }

  text(text: string): string {
    return named(text, this.names);
  }

  name(id: string): string {
    return this.text(`<@${id}>`);
  }

  scene(id: string | null): number | null {
    if (id === null) {
      return null;
    }
    return this.numbers.get(id) ?? null;
  }

  dated(row: { sceneId: string | null; text: string }): Dated {
    return { scene: this.scene(row.sceneId), text: this.text(row.text) };
  }
}

function characterView(viewer: Viewer, character: CharacterRow, story: Story): CharacterView {
  const grown = story.growth.filter((entry) => entry.characterId === character.id);
  return {
    name: character.name,
    protagonist: character.role === 'protagonist',
    who: character.who,
    personality: character.personality,
    past: character.past,
    notes: character.notes,
    growth: grown.map((entry) => viewer.dated(entry)),
  };
}

function relationshipView(viewer: Viewer, line: RelationshipRow, story: Story): RelationshipView {
  const history = story.history.filter((entry) => entry.aId === line.aId && entry.bId === line.bId);
  return {
    bond: line.bond,
    a: { name: viewer.name(line.aId), sees: line.aSees, hides: line.aHides },
    b: { name: viewer.name(line.bId), sees: line.bSees, hides: line.bHides },
    history: history.map((entry) => viewer.dated(entry)),
  };
}

function sceneView(viewer: Viewer, state: SceneState): SceneView {
  const { scene } = state;
  return {
    number: scene.number,
    place: scene.place,
    time: scene.time,
    present: scene.present.map((id) => viewer.name(id)),
    summary: scene.summary,
    turns: state.unfolded.map((turn) => ({
      number: turn.number,
      voice: turn.voice as Voice,
      input: turn.input,
      reply: turn.reply,
    })),
  };
}

/** Who is in the scene: everyone it lists, and always the protagonist. */
function presentIn(story: Story, playing: SceneState | undefined): Set<string> {
  const present = new Set<string>(playing?.scene.present ?? []);
  for (const character of story.characters) {
    if (character.role === 'protagonist') {
      present.add(character.id);
    }
  }
  return present;
}

export function storyView(story: Story): StoryView {
  const viewer = new Viewer(story);
  const { book } = story;
  const length = book.length as Length;
  const playing = story.scenes.find((state) => state.scene.status === 'playing');
  const present = presentIn(story, playing);

  const close: RelationshipView[] = [];
  const distant: BondView[] = [];
  for (const line of story.relationships) {
    if (present.has(line.aId) && present.has(line.bId)) {
      close.push(relationshipView(viewer, line, story));
    } else {
      distant.push({ a: viewer.name(line.aId), b: viewer.name(line.bId), bond: line.bond });
    }
  }

  const protagonist = story.characters.find((character) => character.role === 'protagonist');
  let style = CONVENTIONAL;
  if (length === 'light_novel') {
    style = LIGHT_NOVEL;
  }
  const ended = story.scenes.filter((state) => state.scene.status === 'ended');
  let scene: SceneView | null = null;
  if (playing) {
    scene = sceneView(viewer, playing);
  }

  return {
    title: book.title,
    protagonist: protagonist?.name ?? '',
    length: `${LENGTH_NAMES[length]} of about ${words(book.wordGoal)} words`,
    style,
    pov: POV_NAMES[book.pov as Pov],
    darkness: DARKNESS_NAMES[book.darkness as Darkness],
    pacing: pacingOf(story),
    world: {
      genre: story.world?.genre ?? '',
      tone: story.world?.tone ?? '',
      setting: story.world?.setting ?? '',
      rules: story.world?.rules ?? '',
      notes: story.world?.notes ?? '',
    },
    cast: story.characters.map((character) => characterView(viewer, character, story)),
    close,
    distant,
    arc: viewer.text(story.arc),
    threads: story.threads
      .filter((thread) => thread.closedIn === null)
      .map((thread) => ({ id: thread.id, text: viewer.text(thread.text), opened: viewer.scene(thread.openedIn) })),
    facts: story.facts.map((fact) => viewer.dated(fact)),
    timeline: story.timeline.map((entry) => ({
      scene: viewer.scene(entry.sceneId),
      when: viewer.text(entry.when),
      what: viewer.text(entry.what),
    })),
    earlier: ended.map((state) => sceneView(viewer, state)),
    scene,
  };
}
