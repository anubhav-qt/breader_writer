import { and, eq } from 'drizzle-orm';
import type { MoveAsk, OpenAsk } from '@writer/shared/play';
import { ModelError } from '../ai/call.ts';
import {
  addTurn,
  beginScene,
  frameScene,
  offerOpenings,
  prepareFirstScene,
  setReply,
  takeBackTurn,
  type Frame,
  type Offer,
} from '../breading_ground.ts';
import type { Db } from '../db/client.ts';
import { scenes } from '../db/schema.ts';
import { log } from '../log.ts';
import { askForOpenings, converse } from '../procreator/converse.ts';
import type { Procreator } from '../procreator/run.ts';
import { render } from '../prompts/render.ts';
import { castOf, namesOf, type CharacterRow } from '../story/cast.ts';
import type { Writer } from '../story/changes.ts';
import { newestTurn, nextScene, playingScene, sceneNow, turnsOf, type Scene, type Turn, type Voice } from '../story/scenes.ts';

/*
 * Play (step 6): the owner lives the story a move at a time, and Procreator narrates. The story
 * opens with one of three openings Procreator offers (or the owner's own); each move is a turn,
 * narrated in the scene's session and streamed as it's written; a scene that ends waits for the
 * owner to go on, and until then its last move can still be taken back. Every change goes through
 * breading_ground. A turn Procreator couldn't narrate is taken back, as if it was never made.
 */

/** What play can't do as the story stands, in the owner's words. */
export class PlayError extends Error {}

/** What a move's caller watches as Procreator works. */
export interface Watch {
  /** Procreator's words as it writes them. */
  onText: (delta: string) => void;
  /** Where and when the scene is, when it's set. */
  onScene: (scene: Scene) => void;
  /** The scene before is being finished (its wrap-up) before the next one opens. */
  onFinishing: (scene: number) => void;
}

/** The books Procreator is writing in now: one exchange at a time in each. */
const busy = new Set<string>();

/** Runs work in a book no one else is running in, or throws a PlayError. */
export async function alone<T>(bookId: string, work: () => Promise<T>): Promise<T> {
  if (busy.has(bookId)) {
    throw new PlayError('Procreator is still writing in this book.');
  }
  busy.add(bookId);
  try {
    return await work();
  } finally {
    busy.delete(bookId);
  }
}

function owner(bookId: string): Writer {
  return { bookId, turnId: null, by: 'owner' };
}

function agent(bookId: string): Writer {
  return { bookId, turnId: null, by: 'agent' };
}

async function sceneNumbered(db: Db, bookId: string, number: number): Promise<Scene | null> {
  const [scene] = await db
    .select()
    .from(scenes)
    .where(and(eq(scenes.bookId, bookId), eq(scenes.number, number)));
  if (!scene) {
    return null;
  }
  return scene;
}

async function protagonistOf(db: Db, bookId: string): Promise<CharacterRow> {
  const cast = await castOf(db, bookId);
  const protagonist = cast.find((person) => person.role === 'protagonist');
  if (!protagonist) {
    throw new Error(`Book ${bookId} has no protagonist.`);
  }
  return protagonist;
}

/** The scene on the page: the one being played, or the one that just ended while the next waits. */
async function sceneOnPage(db: Db, bookId: string): Promise<Scene | null> {
  const playing = await playingScene(db, bookId);
  if (playing) {
    return playing;
  }
  const waiting = await nextScene(db, bookId);
  if (!waiting || waiting.number === 1) {
    return null;
  }
  return sceneNumbered(db, bookId, waiting.number - 1);
}

/** A turn as Procreator is sent it (prompts/templates/procreator/turn.njk). */
async function turnMessage(db: Db, scene: Scene, turn: Turn): Promise<string> {
  const names = namesOf(await castOf(db, scene.bookId));
  let played = '';
  if (turn.played !== null) {
    played = names.get(turn.played) ?? '';
  }
  const current = await sceneNow(db, scene.id);
  const present: string[] = [];
  for (const id of current.present) {
    const name = names.get(id);
    if (name !== undefined) {
      present.push(name);
    }
  }
  const view = { number: current.number, place: current.place, time: current.time, present };
  return render('procreator/turn.njk', { voice: turn.voice, input: turn.input, played, scene: view });
}

/** Takes back a turn that failed. If even that fails it's logged, since the first failure is the one to tell. */
async function giveBack(db: Db, turn: Turn) {
  try {
    await takeBackTurn(db, turn);
  } catch (err) {
    log.error({ err, turnId: turn.id }, 'a turn that failed couldn’t be taken back');
  }
}

/** A new turn, and Procreator's narration of it. A turn it couldn't narrate is taken back. */
async function narrate(ai: Procreator, scene: Scene, voice: Voice, input: string, played: string | null, watch: Watch): Promise<Turn> {
  const turn = await addTurn(ai.db, scene, voice, input, played);
  try {
    const text = await turnMessage(ai.db, scene, turn);
    const answer = await converse(ai, scene, text, turn.id, { onText: watch.onText, onScene: watch.onScene });
    if (answer.words === '') {
      throw new ModelError('Procreator wrote nothing.');
    }
    return await setReply(ai.db, turn, answer.words);
  } catch (err) {
    await giveBack(ai.db, turn);
    throw err;
  }
}

/**
 * Asks for the first scene's openings, unless they're offered already. The scene is made first,
 * waiting for the owner's pick, and its session opens for the ask.
 */
export async function askOpenings(ai: Procreator, bookId: string): Promise<void> {
  const made = await sceneNumbered(ai.db, bookId, 1);
  let first: Scene;
  if (made) {
    first = made;
  } else {
    first = await ai.db.transaction((tx) => prepareFirstScene(tx, agent(bookId)));
  }
  if (first.openings || (await newestTurn(ai.db, first.id))) {
    return;
  }
  const protagonist = await protagonistOf(ai.db, bookId);
  const text = render('procreator/openings.njk', { protagonist: protagonist.name });
  const answer = await askForOpenings(ai, first, text);
  const offers = answer.outcome.openings;
  if (!offers) {
    throw new ModelError('Procreator offered no openings.');
  }
  await ai.db.transaction((tx) => offerOpenings(tx, agent(bookId), first, offers));
}

/** Where and when the story opens, and its words, from the owner's pick or their own opening. */
function openingFrom(first: Scene, ask: OpenAsk): { text: string; frame: Frame } {
  if (ask.kind === 'own') {
    // Procreator sets where, when and who as it opens the scene.
    return { text: ask.text, frame: { place: '', time: '', present: [] } };
  }
  const offers = (first.openings ?? []) as Offer[];
  const offer = offers[ask.opening];
  if (!offer) {
    throw new PlayError('There’s no such opening.');
  }
  return { text: offer.text, frame: { place: offer.place, time: offer.time, present: offer.present } };
}

/** The owner opens the story, with an opening offered or their own, and Procreator writes it. */
export async function openStory(ai: Procreator, bookId: string, ask: OpenAsk, watch: Watch): Promise<void> {
  const first = await sceneNumbered(ai.db, bookId, 1);
  if (!first) {
    throw new PlayError('Ask for the openings first.');
  }
  if (await newestTurn(ai.db, first.id)) {
    throw new PlayError('The story has opened already.');
  }
  const opening = openingFrom(first, ask);
  const scene = await ai.db.transaction(async (tx) => {
    if (first.status === 'next') {
      return beginScene(tx, owner(bookId), first, opening.frame);
    }
    return frameScene(tx, owner(bookId), first, opening.frame);
  });
  watch.onScene(scene);
  await narrate(ai, scene, 'opening', opening.text, null, watch);
}

/** The owner's move, or a note as the author, and Procreator's narration of what happens. */
export async function makeMove(ai: Procreator, bookId: string, ask: MoveAsk, watch: Watch): Promise<void> {
  const scene = await playingScene(ai.db, bookId);
  if (!scene) {
    throw new PlayError('No scene is being played.');
  }
  if (!(await newestTurn(ai.db, scene.id))) {
    throw new PlayError(`Scene ${scene.number} hasn’t opened yet.`);
  }
  let played: string | null = null;
  if (ask.voice === 'character') {
    const protagonist = await protagonistOf(ai.db, bookId);
    played = protagonist.id;
  }
  await narrate(ai, scene, ask.voice, ask.text, played, watch);
}

/**
 * The owner goes on to the scene waiting as next. It begins, the scene before is finished (its
 * wrap-up, as its session opens), and Procreator opens it. A scene that began but couldn't be
 * opened is opened again.
 */
export async function goOn(ai: Procreator, bookId: string, watch: Watch): Promise<void> {
  let scene = await playingScene(ai.db, bookId);
  if (scene && (await newestTurn(ai.db, scene.id))) {
    throw new PlayError(`Scene ${scene.number} is being played.`);
  }
  if (!scene) {
    const waiting = await nextScene(ai.db, bookId);
    if (!waiting || waiting.number === 1) {
      throw new PlayError('There’s no scene to go on to.');
    }
    scene = await ai.db.transaction((tx) => beginScene(tx, owner(bookId), waiting, null));
  }
  if (scene.number === 1) {
    throw new PlayError('The story opens with an opening of your pick.');
  }
  watch.onScene(scene);
  watch.onFinishing(scene.number - 1);
  await narrate(ai, scene, 'opening', '', null, watch);
}

/** The newest turn of the scene on the page, and the scene. */
async function newestOnPage(db: Db, bookId: string): Promise<{ scene: Scene; turn: Turn }> {
  const scene = await sceneOnPage(db, bookId);
  if (!scene) {
    throw new PlayError('There’s nothing to take back.');
  }
  const turn = await newestTurn(db, scene.id);
  if (!turn) {
    throw new PlayError('There’s nothing to take back.');
  }
  return { scene, turn };
}

/** Takes the newest turn back, and gives it back for its words. A later scene's opening can only be written again. */
export async function undo(db: Db, bookId: string): Promise<Turn> {
  const { scene, turn } = await newestOnPage(db, bookId);
  if (turn.voice === 'opening' && scene.number > 1) {
    throw new PlayError('A scene’s opening can’t be taken back. Ask for another one instead.');
  }
  await takeBackTurn(db, turn);
  return turn;
}

/** Another reply to the newest turn: it's taken back, and the same move is narrated again. */
export async function another(ai: Procreator, bookId: string, watch: Watch): Promise<void> {
  const { scene, turn } = await newestOnPage(ai.db, bookId);
  await takeBackTurn(ai.db, turn);
  const current = await sceneNow(ai.db, scene.id);
  await narrate(ai, current, turn.voice as Voice, turn.input, turn.played, watch);
}

/** Three moves the owner could make next, asked for in the scene's session and never sent again. */
export async function hintsFor(ai: Procreator, bookId: string): Promise<string[]> {
  const scene = await playingScene(ai.db, bookId);
  if (!scene) {
    throw new PlayError('No scene is being played.');
  }
  const newest = await newestTurn(ai.db, scene.id);
  if (!newest) {
    throw new PlayError(`Scene ${scene.number} hasn’t opened yet.`);
  }
  const protagonist = await protagonistOf(ai.db, bookId);
  const turns = await turnsOf(ai.db, scene.id);
  const moved = turns.some((turn) => turn.voice === 'character');
  const text = render('procreator/hints.njk', { who: protagonist.name, moved });
  const answer = await converse(ai, scene, text, newest.id, { mode: 'hints', kind: 'aside', role: 'hints' });
  if (!answer.outcome.moves) {
    throw new ModelError('Procreator offered no moves.');
  }
  return answer.outcome.moves;
}
