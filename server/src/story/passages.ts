import type { Message } from '@writer/pi-ai';
import { and, asc, eq, getTableName } from 'drizzle-orm';
import { pairKey } from '@writer/shared/book';
import type { Db, Tx } from '../db/client.ts';
import { characters, notes, pages, relationshipHistory, relationships, scenes, sessionMessages, turns, worlds } from '../db/schema.ts';
import { actorSegmentMessages, currentActorSegment } from './actors.ts';
import { isStanding, namesOf } from './cast.ts';
import { edit, remove, StoryError, type Change, type StoryTable } from './changes.ts';
import { Cast, linked, unlinked } from './mentions.ts';
import type { Story } from './read.ts';
import { currentSegment } from './session.ts';
import { cueOf, type Scene, type Turn } from './scenes.ts';

/*
 * The story's passages: every text a change that reaches back may have to rewrite, so what was
 * played reads as if it was always so (see "Changing the past" in CLAUDE.md). The turns, each
 * scene's place, time and summary, the openings offered for the first scene and what Procreator
 * told someone as it stopped a turn for the owner (a cue), the reference (titles too), Procreator's
 * memory, the relationships' history, and the owner's own sheets, lines and world; and the working
 * copies that will be sent again, the owner's notes in a scene's session and the actors' chats.
 *
 * They're read in groups, a scene at a time and then the rest, as Procreator rewrites them. A
 * story passage is kept back through the change log, so it keeps the version it replaced; a
 * working copy isn't the story, and is rebuilt with its new words (procreator/rebuild.ts).
 */

/** A part of one of the openings offered for the first scene. */
export type OpeningField = 'text' | 'place' | 'time';

/** Where a passage is kept: a column of one of the story's rows, part of one, or a working copy. */
export type Spot =
  | { kind: 'story'; table: StoryTable; key: Record<string, unknown>; column: string; linked: boolean }
  /** Part of one of the openings offered for the first scene, kept together on the scene. */
  | { kind: 'opening'; sceneId: string; index: number; field: OpeningField }
  /** What Procreator told someone as it stopped a turn for the owner to say who plays them. */
  | { kind: 'cue'; turnId: string }
  /** A note in a scene's session: a change the owner made from now on. */
  | { kind: 'note'; id: number }
  /** A message of an actor's chat: a cue, or their answer. */
  | { kind: 'actor'; id: number }
  /** What an actor remembers, after a compaction of their chat. */
  | { kind: 'memory'; id: number };

export interface Passage {
  spot: Spot;
  /** Where it is in the story, as the owner and Procreator read it ("Scene 2, turn 3: the narration"). */
  where: string;
  /** Its text, with people as links ([[Name]]) where it's structured. */
  text: string;
  /** For a page's title: every other page's title, in lower case, which it can't take. */
  taken?: string[];
}

/** Whether a passage is the story's own, kept back through the change log, rather than a working copy. */
export function isOwn(spot: Spot): boolean {
  return spot.kind === 'story' || spot.kind === 'opening' || spot.kind === 'cue';
}

/** A scene's passages, or the rest of the story's (scene null). */
export interface PassageGroup {
  scene: number | null;
  passages: Passage[];
}

/** What the change makes or takes out itself, so it isn't rewritten as well. */
export interface Untouched {
  /** The sheets it changes, by id. */
  sheets: string[];
  /** The lines it ties, changes or unties, by pair key. */
  lines: string[];
  /** Whether it changes the world. */
  world: boolean;
  /** Someone it takes out of the story whole: their page, lines and history go with them. */
  removed: string | null;
  /** The pages it writes or takes out, by id. */
  pages: string[];
}

export const NOTHING_UNTOUCHED: Untouched = { sheets: [], lines: [], world: false, removed: null, pages: [] };

const SHEET_FIELDS = [
  { column: 'who', label: 'who they are' },
  { column: 'personality', label: 'their personality' },
  { column: 'past', label: 'their past' },
  { column: 'notes', label: 'notes' },
] as const;

const WORLD_FIELDS = [
  { column: 'genre', label: 'its genre' },
  { column: 'tone', label: 'its tone' },
  { column: 'setting', label: 'its setting' },
  { column: 'rules', label: 'the rules that matter' },
  { column: 'notes', label: 'notes' },
] as const;

/** A message's words: a cue's text, or an answer's. */
export function messageText(message: Message): string {
  if (typeof message.content === 'string') {
    return message.content;
  }
  const words: string[] = [];
  for (const block of message.content) {
    if (block.type === 'text') {
      words.push(block.text);
    }
  }
  return words.join('');
}

/** How people are named in the passages: as they'll be once the change is made. */
class Names {
  private readonly names: Map<string, string>;
  private readonly places = new Map<string, number>();

  constructor(story: Story, names: Map<string, string>) {
    this.names = names;
    story.characters.forEach((person, place) => this.places.set(person.id, place));
  }

  of(id: string): string {
    return this.names.get(id) ?? 'someone';
  }

  get map(): Map<string, string> {
    return this.names;
  }

  /** Two people in cast order, the one the owner plays first. */
  inOrder(a: string, b: string): [string, string] {
    const placeOfA = this.places.get(a) ?? Infinity;
    const placeOfB = this.places.get(b) ?? Infinity;
    if (placeOfB < placeOfA) {
      return [b, a];
    }
    return [a, b];
  }

  pair(a: string, b: string): string {
    const [first, second] = this.inOrder(a, b);
    return `${this.of(first)} and ${this.of(second)}`;
  }
}

function storySpot(table: StoryTable, key: Record<string, unknown>, column: string, isLinked = false): Spot {
  return { kind: 'story', table, key, column, linked: isLinked };
}

/** What the owner's words in a turn are, as the owner reads it. */
function inputLabel(turn: Turn, names: Names, protagonist: string): string {
  if (turn.voice === 'author') {
    return 'your note as the author';
  }
  if (turn.voice === 'opening') {
    return 'the opening you picked';
  }
  if (turn.voice === 'actor') {
    return `${names.of(turn.played ?? '')}’s actor’s answer`;
  }
  if (turn.played !== null && turn.played !== protagonist) {
    return `your move as ${names.of(turn.played)}`;
  }
  return 'your move';
}

/** One of the openings offered for the first scene, as the story keeps it. */
interface Offered {
  text: string;
  place: string;
  time: string;
  present: string[];
}

const OPENING_PARTS: { field: OpeningField; label: string }[] = [
  { field: 'text', label: 'its words' },
  { field: 'place', label: 'where it opens' },
  { field: 'time', label: 'when' },
];

/** The openings offered for the first scene, kept to show again if the owner takes the opening back. */
function openingPassages(scene: Scene): Passage[] {
  if (!scene.openings) {
    return [];
  }
  const passages: Passage[] = [];
  const offers = scene.openings as Offered[];
  offers.forEach((offer, index) => {
    for (const part of OPENING_PARTS) {
      const text = offer[part.field];
      if (text) {
        passages.push({
          spot: { kind: 'opening', sceneId: scene.id, index, field: part.field },
          where: `Scene ${scene.number}: opening ${index + 1} offered, ${part.label}`,
          text,
        });
      }
    }
  });
  return passages;
}

/** A scene's own passages: where and when it is, its summary, and its turns that still stand. */
async function scenePassages(db: Db | Tx, scene: Scene, names: Names, protagonist: string): Promise<Passage[]> {
  const passages: Passage[] = [];
  const key = { id: scene.id };
  if (scene.place) {
    passages.push({ spot: storySpot(scenes, key, 'place'), where: `Scene ${scene.number}: where it takes place`, text: scene.place });
  }
  if (scene.time) {
    passages.push({ spot: storySpot(scenes, key, 'time'), where: `Scene ${scene.number}: when`, text: scene.time });
  }
  if (scene.summary) {
    passages.push({ spot: storySpot(scenes, key, 'summary'), where: `Scene ${scene.number}: its summary`, text: scene.summary });
  }
  const standing = await db
    .select()
    .from(turns)
    .where(and(eq(turns.sceneId, scene.id), eq(turns.undone, false)))
    .orderBy(asc(turns.number));
  standing.forEach((turn, index) => {
    const at = `Scene ${scene.number}, turn ${index + 1}`;
    if (turn.input) {
      passages.push({ spot: storySpot(turns, { id: turn.id }, 'input'), where: `${at}: ${inputLabel(turn, names, protagonist)}`, text: turn.input });
    }
    if (turn.reply) {
      passages.push({ spot: storySpot(turns, { id: turn.id }, 'reply'), where: `${at}: the narration`, text: turn.reply });
    }
    const cue = cueOf(turn);
    if (cue && cue.sees) {
      passages.push({ spot: { kind: 'cue', turnId: turn.id }, where: `${at}: what Procreator told ${names.of(cue.who)} as it cued them`, text: cue.sees });
    }
  });
  return passages;
}

/** Whether a scene's session will be sent again: it's being played, or it ended and waits for its wrap-up. */
export function sessionGoesOn(scene: Scene): boolean {
  if (scene.status === 'playing') {
    return true;
  }
  return scene.status === 'ended' && scene.summary === '';
}

/** The owner's notes in a scene's session that will be sent again. */
async function notePassages(db: Db | Tx, scene: Scene): Promise<Passage[]> {
  if (!sessionGoesOn(scene) || !(await currentSegment(db, scene.id))) {
    return [];
  }
  const rows = await db
    .select()
    .from(sessionMessages)
    .where(and(eq(sessionMessages.sceneId, scene.id), eq(sessionMessages.kind, 'note'), eq(sessionMessages.undone, false)))
    .orderBy(asc(sessionMessages.seq));
  return rows.map((row) => ({
    spot: { kind: 'note', id: row.id },
    where: `Scene ${scene.number}: a change you made from now on, as Procreator was told it`,
    text: messageText(row.message as Message),
  }));
}

/** The actors' chats as they'll be sent again, by scene, and what each remembers. */
async function actorPassages(db: Db | Tx, story: Story, names: Names, untouched: Untouched) {
  const byScene = new Map<string, Passage[]>();
  const memories: Passage[] = [];
  for (const person of story.characters) {
    // Someone who left is never cued again.
    if (person.id === untouched.removed || !isStanding(person)) {
      continue;
    }
    const segment = await currentActorSegment(db, { bookId: story.book.id, characterId: person.id });
    if (!segment) {
      continue;
    }
    const name = names.of(person.id);
    if (segment.memory) {
      memories.push({ spot: { kind: 'memory', id: segment.id }, where: `What ${name}’s actor remembers`, text: segment.memory });
    }
    for (const each of await actorSegmentMessages(db, segment)) {
      let what = 'their answer';
      if (each.message.role === 'user') {
        what = 'a cue from Procreator';
      }
      const list = byScene.get(each.row.sceneId) ?? [];
      list.push({ spot: { kind: 'actor', id: each.row.id }, where: `${name}’s actor’s chat: ${what}`, text: messageText(each.message) });
      byScene.set(each.row.sceneId, list);
    }
  }
  return { byScene, memories };
}

/** The reference, memory, the relationships' history, and the owner's own sheets, lines and world. */
function restPassages(story: Story, names: Names, untouched: Untouched): Passage[] {
  const passages: Passage[] = [];
  const removed = untouched.removed;
  const titles = story.pages.filter((page) => page.characterId === null).map((page) => page.title.toLowerCase());
  for (const page of story.pages) {
    if (page.characterId !== null && page.characterId === removed) {
      continue;
    }
    if (untouched.pages.includes(page.id)) {
      continue;
    }
    let title = `The page ${page.title}`;
    if (page.characterId !== null) {
      title = `${names.of(page.characterId)}’s page`;
    } else {
      const taken = titles.filter((other) => other !== page.title.toLowerCase());
      passages.push({ spot: storySpot(pages, { id: page.id }, 'title'), where: `${title}: its title`, text: page.title, taken });
    }
    if (page.about) {
      passages.push({ spot: storySpot(pages, { id: page.id }, 'about'), where: `${title}: what it holds`, text: page.about });
    }
    if (page.body) {
      passages.push({ spot: storySpot(pages, { id: page.id }, 'body', true), where: title, text: linked(page.body, names.map) });
    }
  }
  for (const note of story.notes) {
    passages.push({ spot: storySpot(notes, { id: note.id }, 'text', true), where: 'Procreator’s memory', text: linked(note.text, names.map) });
  }
  for (const entry of story.history) {
    const gone = entry.aId === removed || entry.bId === removed;
    if (gone || untouched.lines.includes(pairKey(entry.aId, entry.bId))) {
      continue;
    }
    passages.push({
      spot: storySpot(relationshipHistory, { id: entry.id }, 'text', true),
      where: `${names.pair(entry.aId, entry.bId)}: their history`,
      text: linked(entry.text, names.map),
    });
  }
  for (const person of story.characters) {
    if (person.id === removed || untouched.sheets.includes(person.id)) {
      continue;
    }
    for (const field of SHEET_FIELDS) {
      const text = person[field.column];
      if (text) {
        passages.push({
          spot: storySpot(characters, { bookId: person.bookId, id: person.id }, field.column),
          where: `${names.of(person.id)}’s sheet: ${field.label}`,
          text,
        });
      }
    }
  }
  for (const line of story.relationships) {
    const gone = line.aId === removed || line.bId === removed;
    if (gone || untouched.lines.includes(pairKey(line.aId, line.bId))) {
      continue;
    }
    const key = { bookId: line.bookId, aId: line.aId, bId: line.bId };
    const a = names.of(line.aId);
    const b = names.of(line.bId);
    const fields = [
      { column: 'bond', label: 'what they are to each other', text: line.bond },
      { column: 'aSees', label: `how ${a} sees ${b}`, text: line.aSees },
      { column: 'aHides', label: `what ${a} hides from ${b}`, text: line.aHides },
      { column: 'bSees', label: `how ${b} sees ${a}`, text: line.bSees },
      { column: 'bHides', label: `what ${b} hides from ${a}`, text: line.bHides },
    ];
    for (const field of fields) {
      if (field.text) {
        passages.push({ spot: storySpot(relationships, key, field.column), where: `${names.pair(line.aId, line.bId)}: ${field.label}`, text: field.text });
      }
    }
  }
  if (story.world && !untouched.world) {
    for (const field of WORLD_FIELDS) {
      const text = story.world[field.column];
      if (text) {
        passages.push({ spot: storySpot(worlds, { bookId: story.book.id }, field.column), where: `The world: ${field.label}`, text });
      }
    }
  }
  return passages;
}

/**
 * Every passage of the story, a scene at a time and then the rest, with people named as `names`
 * has them: as they'll be once the change is made. Leaves out what the change makes or takes out
 * itself.
 */
export async function passagesOf(db: Db | Tx, story: Story, names: Map<string, string>, untouched: Untouched): Promise<PassageGroup[]> {
  const named = new Names(story, names);
  const protagonist = story.characters.find((person) => person.role === 'protagonist')?.id ?? '';
  const actors = await actorPassages(db, story, named, untouched);
  const groups: PassageGroup[] = [];
  for (const scene of story.scenes) {
    const passages = await scenePassages(db, scene, named, protagonist);
    passages.push(...(await notePassages(db, scene)));
    passages.push(...(actors.byScene.get(scene.id) ?? []));
    // Last, as they matter least: they only show again if the owner takes the opening back.
    passages.push(...openingPassages(scene));
    if (passages.length > 0) {
      groups.push({ scene: scene.number, passages });
    }
  }
  const rest = restPassages(story, named, untouched);
  rest.push(...actors.memories);
  if (rest.length > 0) {
    groups.push({ scene: null, passages: rest });
  }
  return groups;
}

/** A spot of the story's own, the same however its row's key is ordered: its table, its row and its column. */
export function spotKey(table: string, key: Record<string, unknown>, column: string): string {
  const entries = Object.entries(key).sort(([a], [b]) => a.localeCompare(b));
  return `${table} ${JSON.stringify(entries)} ${column}`;
}

/** Where a passage of the story's own is kept, as spotKey has it: openings and a cue are kept whole on their rows. */
function keyOfSpot(spot: Spot): string | null {
  if (spot.kind === 'story') {
    return spotKey(getTableName(spot.table), spot.key, spot.column);
  }
  if (spot.kind === 'opening') {
    return spotKey('scenes', { id: spot.sceneId }, 'openings');
  }
  if (spot.kind === 'cue') {
    return spotKey('turns', { id: spot.turnId }, 'cue');
  }
  return null;
}

/** Where the openings offered are, as the owner reads it. */
export const OPENINGS_WHERE = 'Scene 1: the openings offered';

/** Where each of the story's own passages is, as the owner reads it, by spotKey: for looking a rewrite over. */
export async function wheresOf(db: Db | Tx, story: Story): Promise<Map<string, string>> {
  const groups = await passagesOf(db, story, namesOf(story.characters), NOTHING_UNTOUCHED);
  const wheres = new Map<string, string>();
  for (const group of groups) {
    for (const passage of group.passages) {
      const key = keyOfSpot(passage.spot);
      if (key === null) {
        continue;
      }
      if (passage.spot.kind === 'opening') {
        wheres.set(key, OPENINGS_WHERE);
      } else {
        wheres.set(key, passage.where);
      }
    }
  }
  return wheres;
}

/** Whether a passage may be emptied: a memory note or a history entry, which then goes. */
export function mayEmpty(passage: Passage): boolean {
  if (passage.spot.kind !== 'story') {
    return false;
  }
  return passage.spot.table === notes || passage.spot.table === relationshipHistory;
}

function isTitle(spot: Spot): boolean {
  return spot.kind === 'story' && spot.table === pages && spot.column === 'title';
}

/** Why a page's new title can't be kept: what any title needs, and not a person's name or another page's. Null when it can. */
function titleProblem(passage: Passage, text: string, cast: Cast): string | null {
  const title = text.trim().replace(/\s+/g, ' ');
  if (/[[\]]/.test(title)) {
    return 'A page’s title is written without brackets.';
  }
  if (cast.idsOf(title).length > 0) {
    return `${title} is someone in the cast, whose page goes by their name. Give the page another title.`;
  }
  const taken = passage.taken ?? [];
  if (taken.includes(title.toLowerCase())) {
    return `Another page is called ${title} already.`;
  }
  return null;
}

/**
 * Whether a story passage's new text can be kept: its links name people in the cast as it will
 * stand, and a page's title is one a page can have. Null when it can.
 */
export function keepProblem(passage: Passage, text: string, cast: Cast): string | null {
  if (isTitle(passage.spot)) {
    return titleProblem(passage, text, cast);
  }
  if (passage.spot.kind !== 'story' || !passage.spot.linked) {
    return null;
  }
  try {
    unlinked(text, cast);
    return null;
  } catch (err) {
    if (err instanceof StoryError) {
      return err.message;
    }
    throw err;
  }
}

/** A text as its column keeps it: a memory note, a page's title and its line for the index on one line. */
function keptText(passage: Passage, text: string): string {
  const spot = passage.spot;
  if (spot.kind !== 'story') {
    return text.trim();
  }
  const oneLine = spot.table === notes || (spot.table === pages && (spot.column === 'about' || spot.column === 'title'));
  if (oneLine) {
    return text.trim().replace(/\s+/g, ' ');
  }
  return text.trim();
}

/** A passage and its new words. */
export interface NewWords {
  passage: Passage;
  text: string;
}

/** A column of one of the story's rows rewritten. An emptied note or history entry goes. */
async function rewriteColumn(tx: Tx, change: Change, passage: Passage, text: string, cast: Cast) {
  const spot = passage.spot;
  if (spot.kind !== 'story') {
    throw new Error('Only a column of the story’s rows is rewritten here.');
  }
  let kept = keptText(passage, text);
  if (kept === '') {
    if (!mayEmpty(passage)) {
      throw new StoryError(`${passage.where} can’t be left empty.`);
    }
    await remove(tx, change, spot.table, spot.key);
    return;
  }
  if (spot.linked) {
    kept = unlinked(kept, cast);
  }
  await edit(tx, change, spot.table, spot.key, { [spot.column]: kept });
}

/** The openings offered for a scene, rewritten where Procreator rewrote them, kept as one edit to the scene. */
async function rewriteOpenings(tx: Tx, change: Change, sceneId: string, words: NewWords[]) {
  const [scene] = await tx.select().from(scenes).where(eq(scenes.id, sceneId));
  if (!scene || !scene.openings) {
    return;
  }
  const offers = (scene.openings as Offered[]).map((offer) => ({ ...offer }));
  for (const each of words) {
    const spot = each.passage.spot;
    if (spot.kind !== 'opening' || !offers[spot.index]) {
      continue;
    }
    const kept = each.text.trim();
    if (kept === '') {
      throw new StoryError(`${each.passage.where} can’t be left empty.`);
    }
    offers[spot.index][spot.field] = kept;
  }
  await edit(tx, change, scenes, { id: sceneId }, { openings: offers });
}

/** What Procreator told someone as it cued them, rewritten. */
async function rewriteCue(tx: Tx, change: Change, turnId: string, text: string) {
  const [turn] = await tx.select().from(turns).where(eq(turns.id, turnId));
  if (!turn) {
    return;
  }
  const cue = cueOf(turn);
  if (!cue) {
    return;
  }
  await edit(tx, change, turns, { id: turnId }, { cue: { ...cue, sees: text.trim() } });
}

/**
 * The story's own passages rewritten, as part of the change: each column, the openings offered
 * (kept together on their scene) and the cues. Answers with how many of the story's rows it
 * changed. Only breading_ground calls this.
 */
export async function rewritePassages(tx: Tx, change: Change, words: NewWords[], cast: Cast): Promise<number> {
  let rows = 0;
  const openings = new Map<string, NewWords[]>();
  for (const each of words) {
    const spot = each.passage.spot;
    if (spot.kind === 'story') {
      await rewriteColumn(tx, change, each.passage, each.text, cast);
      rows += 1;
    } else if (spot.kind === 'cue') {
      await rewriteCue(tx, change, spot.turnId, each.text);
      rows += 1;
    } else if (spot.kind === 'opening') {
      const list = openings.get(spot.sceneId) ?? [];
      list.push(each);
      openings.set(spot.sceneId, list);
    }
  }
  for (const [sceneId, list] of openings) {
    await rewriteOpenings(tx, change, sceneId, list);
    rows += 1;
  }
  return rows;
}
