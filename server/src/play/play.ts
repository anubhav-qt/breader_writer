import { and, eq } from 'drizzle-orm';
import type { Going, MoveAsk, OpenAsk } from '@writer/shared/play';
import { ModelError } from '../ai/call.ts';
import {
  addTurn,
  beginScene,
  frameScene,
  offerOpenings,
  prepareFirstScene,
  setActorAnswer,
  setReply,
  takeBackTurn,
  type Frame,
  type Offer,
} from '../breading_ground.ts';
import type { Db } from '../db/client.ts';
import { scenes } from '../db/schema.ts';
import { log } from '../log.ts';
import { cueActor, tellActor, type Moment } from '../procreator/actor.ts';
import { askForOpenings, converse } from '../procreator/converse.ts';
import type { Procreator } from '../procreator/run.ts';
import { render } from '../prompts/render.ts';
import { castOf, namesOf, type CharacterRow } from '../story/cast.ts';
import type { Writer } from '../story/changes.ts';
import {
  cueOf,
  newestTurn,
  nextScene,
  playingScene,
  sceneNow,
  turnsOf,
  type Cue,
  type Scene,
  type Turn,
  type Voice,
} from '../story/scenes.ts';

/*
 * Play (step 6): the owner lives the story a move at a time, and Procreator narrates. The story
 * opens with one of three openings Procreator offers (or the owner's own); each move is a turn,
 * narrated in the scene's session and streamed as it's written; a scene that ends waits for the
 * owner to go on, and until then its last move can still be taken back. Every change goes through
 * breading_ground. A turn Procreator couldn't narrate is taken back, as if it was never made.
 *
 * With the switch "Main character and author only" off, Procreator stops a turn when someone in
 * the cast is about to act (a cue), and the next turn answers it: the owner plays them (a move as
 * them, which their actor is told of), or their actor does (a turn of the actor's).
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

/** Someone in the cast, by id, with their name as it is now. */
async function personOf(db: Db, bookId: string, id: string): Promise<{ id: string; name: string }> {
  const cast = await castOf(db, bookId);
  const person = cast.find((each) => each.id === id);
  if (!person) {
    throw new PlayError('The one Procreator asked about isn’t in the cast any more.');
  }
  return { id: person.id, name: person.name };
}

/** The cue the scene's newest turn stopped at, while the owner says who plays them, or null. */
async function pendingCue(db: Db, scene: Scene): Promise<Cue | null> {
  const newest = await newestTurn(db, scene.id);
  if (!newest) {
    return null;
  }
  return cueOf(newest);
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

/** A turn to make: its voice, the owner's words, who it's played as, and the cue it answers, if any. */
interface Move {
  voice: Voice;
  input: string;
  played: string | null;
  cue: Cue | null;
}

/**
 * A turn that answers a cue, before Procreator is sent it. When the owner played the one cued,
 * their actor is told what they saw and did, so it's theirs; when their actor plays, it's cued, and
 * its answer is the turn's.
 */
async function answerCue(ai: Procreator, scene: Scene, turn: Turn, cue: Cue): Promise<Turn> {
  const person = await personOf(ai.db, scene.bookId, cue.who);
  const moment: Moment = { person, scene, turnId: turn.id };
  if (turn.voice === 'actor') {
    const answer = await cueActor(ai, moment, cue.sees);
    return setActorAnswer(ai.db, turn, answer);
  }
  await tellActor(ai, moment, cue.sees, turn.input);
  return turn;
}

/** Takes back a turn that failed. If even that fails it's logged, since the first failure is the one to tell. */
async function giveBack(db: Db, turn: Turn) {
  try {
    await takeBackTurn(db, turn);
  } catch (err) {
    log.error({ err, turnId: turn.id }, 'a turn that failed couldn’t be taken back');
  }
}

/**
 * A new turn, and Procreator's narration of it. A turn it couldn't narrate is taken back. A turn
 * that stopped for the owner to say who plays someone may have no words yet.
 */
async function narrate(ai: Procreator, scene: Scene, move: Move, going: Going, watch: Watch): Promise<Turn> {
  const made = await addTurn(ai.db, scene, move.voice, move.input, move.played);
  try {
    let turn = made;
    if (move.cue) {
      turn = await answerCue(ai, scene, made, move.cue);
    }
    const text = await turnMessage(ai.db, scene, turn);
    const asking = { playOthers: going.playOthers, onText: watch.onText, onScene: watch.onScene };
    const answer = await converse(ai, scene, text, turn.id, asking);
    const cued = answer.outcome.cued;
    if (answer.words === '' && cued === null) {
      throw new ModelError('Procreator wrote nothing.');
    }
    return await setReply(ai.db, turn, answer.words, cued);
  } catch (err) {
    await giveBack(ai.db, made);
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
  const move: Move = { voice: 'opening', input: opening.text, played: null, cue: null };
  await narrate(ai, scene, move, { playOthers: ask.playOthers }, watch);
}

/** The scene being played, once it has opened. */
async function sceneInPlay(db: Db, bookId: string): Promise<Scene> {
  const scene = await playingScene(db, bookId);
  if (!scene) {
    throw new PlayError('No scene is being played.');
  }
  if (!(await newestTurn(db, scene.id))) {
    throw new PlayError(`Scene ${scene.number} hasn’t opened yet.`);
  }
  return scene;
}

/**
 * The turn the owner's words make. While someone cued is about to act, it can only be a move as
 * them; otherwise a move as the protagonist, or a note as the author.
 */
async function moveOf(db: Db, scene: Scene, ask: MoveAsk): Promise<Move> {
  const cue = await pendingCue(db, scene);
  if (cue) {
    const person = await personOf(db, scene.bookId, cue.who);
    if (ask.voice !== 'character' || ask.as !== cue.who) {
      throw new PlayError(`${person.name} is about to act. Play ${person.name}, or let their actor.`);
    }
    return { voice: 'character', input: ask.text, played: cue.who, cue };
  }
  if (ask.voice === 'author') {
    return { voice: 'author', input: ask.text, played: null, cue: null };
  }
  const protagonist = await protagonistOf(db, scene.bookId);
  if (ask.as !== undefined && ask.as !== protagonist.id) {
    throw new PlayError(`No one but ${protagonist.name} is about to act.`);
  }
  return { voice: 'character', input: ask.text, played: protagonist.id, cue: null };
}

/** The owner's move, or a note as the author, and Procreator's narration of what happens. */
export async function makeMove(ai: Procreator, bookId: string, ask: MoveAsk, watch: Watch): Promise<void> {
  const scene = await sceneInPlay(ai.db, bookId);
  const move = await moveOf(ai.db, scene, ask);
  await narrate(ai, scene, move, { playOthers: ask.playOthers }, watch);
}

/** The one about to act is played by their actor this time: their answer is a turn, and Procreator writes it. */
export async function letActorPlay(ai: Procreator, bookId: string, going: Going, watch: Watch): Promise<void> {
  const scene = await sceneInPlay(ai.db, bookId);
  const cue = await pendingCue(ai.db, scene);
  if (!cue) {
    throw new PlayError('No one is waiting for the owner to say who plays them.');
  }
  const move: Move = { voice: 'actor', input: '', played: cue.who, cue };
  await narrate(ai, scene, move, going, watch);
}

/**
 * The owner goes on to the scene waiting as next. It begins, the scene before is finished (its
 * wrap-up, as its session opens), and Procreator opens it. A scene that began but couldn't be
 * opened is opened again.
 */
export async function goOn(ai: Procreator, bookId: string, going: Going, watch: Watch): Promise<void> {
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
  const move: Move = { voice: 'opening', input: '', played: null, cue: null };
  await narrate(ai, scene, move, going, watch);
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

/**
 * Another reply to the newest turn: it's taken back, and the same move is narrated again. A turn
 * that answered a cue answers it again (the cue stands once the turn is taken back), so an actor's
 * turn has its actor play the moment afresh.
 */
export async function another(ai: Procreator, bookId: string, going: Going, watch: Watch): Promise<void> {
  const { scene, turn } = await newestOnPage(ai.db, bookId);
  await takeBackTurn(ai.db, turn);
  const current = await sceneNow(ai.db, scene.id);
  const cue = await pendingCue(ai.db, current);
  let input = turn.input;
  if (turn.voice === 'actor') {
    input = '';
  }
  const move: Move = { voice: turn.voice as Voice, input, played: turn.played, cue };
  await narrate(ai, current, move, going, watch);
}

/**
 * Three moves the owner could make next, asked for in the scene's session and never sent again:
 * the protagonist's, or while someone cued is about to act, theirs.
 */
export async function hintsFor(ai: Procreator, bookId: string): Promise<string[]> {
  const scene = await sceneInPlay(ai.db, bookId);
  const newest = await newestTurn(ai.db, scene.id);
  if (!newest) {
    throw new PlayError(`Scene ${scene.number} hasn’t opened yet.`);
  }
  const cue = cueOf(newest);
  let who: { id: string; name: string };
  if (cue) {
    who = await personOf(ai.db, bookId, cue.who);
  } else {
    who = await protagonistOf(ai.db, bookId);
  }
  const turns = await turnsOf(ai.db, scene.id);
  const moved = turns.some((turn) => turn.voice === 'character' && turn.played === who.id);
  const text = render('procreator/hints.njk', { who: who.name, moved });
  const answer = await converse(ai, scene, text, newest.id, { mode: 'hints', kind: 'aside', role: 'hints' });
  if (!answer.outcome.moves) {
    throw new ModelError('Procreator offered no moves.');
  }
  return answer.outcome.moves;
}
