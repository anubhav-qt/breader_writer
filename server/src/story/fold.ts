import { estimateTextTokens, type Api, type Model } from '@writer/pi-ai';
import { eq } from 'drizzle-orm';
import { ask, type Answer } from '../ai/call.ts';
import type { Catalog } from '../ai/catalog.ts';
import type { InUse } from '../ai/settings.ts';
import type { Db } from '../db/client.ts';
import { scenes } from '../db/schema.ts';
import { log } from '../log.ts';
import { render } from '../prompts/render.ts';
import { edit, startChange, StoryError } from './changes.ts';
import { readStory, type SceneState, type Story } from './read.ts';
import type { Scene, Turn } from './scenes.ts';
import { storyView, type SceneView, type StoryView } from './view.ts';

/*
 * Compaction, done constantly. A scene's played turns fold into its summary: all of them when it
 * ends, and the oldest of the scene being played whenever the story outgrows its budget. The
 * summary is saved before the turns leave the context, and the turns themselves are never
 * deleted, so nothing is lost: if the model fails, nothing changes and the turns stay as they
 * were. Folding is iterative, as pi's compaction is: the summary so far goes in with the turns.
 */

/** The most the story takes of a call's context, however big the model's window. */
export const BUDGET = 200_000;
/** A model with a small window gets this share of it. */
const WINDOW_SHARE = 0.5;
/** Folding mid scene leaves the story this far under budget, so it doesn't fold again next turn. */
const FOLD_TO = 0.75;
/** The latest turns of the scene being played stay word for word, however full the context. */
export const KEEP_TURNS = 4;

/** What folding needs: the database, and the model and account it runs on. */
export interface Folding {
  db: Db;
  catalog: Catalog;
  inUse: InUse;
  userId: string;
  signal?: AbortSignal;
}

/** What the fold's templates take (prompts/templates/fold/). */
export interface FoldPrompt {
  /** The story, without the scene being folded among the earlier ones. */
  story: StoryView;
  /** The scene being folded: its summary so far, and only the turns to fold. */
  fold: SceneView;
  /** Whether these are the last turns of a scene that has ended. */
  ending: boolean;
}

/** A fold that couldn't be saved. The turns stay as they were. */
export class FoldError extends Error {}

export function budgetFor(model: Model<Api>): number {
  const share = Math.floor(model.contextWindow * WINDOW_SHARE);
  return Math.min(BUDGET, share);
}

/** The tokens the story and the scene being played take in a call, as pi estimates them. */
export function contextTokens(view: StoryView): number {
  const text = render('partials/context.njk', { story: view });
  return estimateTextTokens(text);
}

function sceneIn(view: StoryView, number: number): SceneView {
  const scenesShown = [...view.earlier];
  if (view.scene) {
    scenesShown.push(view.scene);
  }
  const found = scenesShown.find((scene) => scene.number === number);
  if (!found) {
    throw new Error(`Scene ${number} isn't in the story's view.`);
  }
  return found;
}

export function foldPrompt(story: Story, state: SceneState, folding: Turn[]): FoldPrompt {
  const view = storyView(story);
  const { number } = state.scene;
  const whole = sceneIn(view, number);
  const folded = new Set(folding.map((turn) => turn.number));
  const ending = state.scene.status === 'ended' && folding.length === state.unfolded.length;
  return {
    story: { ...view, earlier: view.earlier.filter((scene) => scene.number !== number) },
    fold: { ...whole, turns: whole.turns.filter((turn) => folded.has(turn.number)) },
    ending,
  };
}

/** The model's summary, or why it can't be kept. */
function summaryFrom(answer: Answer, scene: Scene): string {
  if (answer.stopReason === 'length') {
    throw new FoldError(`The summary of scene ${scene.number} was cut off, so its turns stay as they were.`);
  }
  const summary = answer.text.trim();
  if (!summary) {
    throw new FoldError(`The model wrote no summary of scene ${scene.number}, so its turns stay as they were.`);
  }
  return summary;
}

/** Saves the summary and moves the fold past its turns, unless another fold got there first. */
async function saveFold(db: Db, scene: Scene, folded: Turn[], summary: string): Promise<Scene> {
  const first = folded[0];
  const last = folded[folded.length - 1];
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(scenes).where(eq(scenes.id, scene.id)).for('update');
    if (current.foldedThrough !== scene.foldedThrough) {
      throw new FoldError(`Scene ${scene.number} was folded meanwhile.`);
    }
    let what = `Folded turns ${first.number} to ${last.number} into scene ${scene.number}'s summary`;
    if (first.number === last.number) {
      what = `Folded turn ${first.number} into scene ${scene.number}'s summary`;
    }
    const change = await startChange(tx, { bookId: scene.bookId, turnId: last.id, by: 'agent', what });
    return edit(tx, change, scenes, { id: scene.id }, { summary, foldedThrough: last.number });
  });
}

async function sceneState(db: Db, sceneId: string): Promise<{ story: Story; state: SceneState }> {
  const [scene] = await db.select().from(scenes).where(eq(scenes.id, sceneId));
  if (!scene) {
    throw new StoryError(`There's no scene ${sceneId}.`);
  }
  const story = await readStory(db, scene.bookId);
  const state = story.scenes.find((each) => each.scene.id === sceneId);
  if (!state) {
    throw new Error(`Scene ${sceneId} isn't in its book's story.`);
  }
  return { story, state };
}

/** Folds a scene's turns, up to and including turn number `through`, into its summary. */
export async function foldTurns(ai: Folding, sceneId: string, through: number): Promise<Scene> {
  const { story, state } = await sceneState(ai.db, sceneId);
  const folding = state.unfolded.filter((turn) => turn.number <= through);
  if (folding.length === 0) {
    return state.scene;
  }
  const prompt = foldPrompt(story, state, folding);
  const answer = await ask(ai.db, ai.catalog, ai.inUse, {
    userId: ai.userId,
    bookId: state.scene.bookId,
    sceneId,
    turnId: folding[folding.length - 1].id,
    role: 'fold',
    system: render('fold/system.njk', prompt),
    user: render('fold/task.njk', prompt),
    signal: ai.signal,
  });
  const summary = summaryFrom(answer, state.scene);
  return saveFold(ai.db, state.scene, folding, summary);
}

/** Folds every turn of a scene not folded yet: at its end, when its summary becomes the whole scene. */
export async function foldScene(ai: Folding, sceneId: string): Promise<Scene> {
  const { state } = await sceneState(ai.db, sceneId);
  const last = state.unfolded.at(-1);
  if (!last) {
    return state.scene;
  }
  return foldTurns(ai, sceneId, last.number);
}

/** Folds the scenes that have ended with turns still unfolded, as when a fold failed at a scene's end. */
export async function foldEnded(ai: Folding, bookId: string): Promise<number> {
  const story = await readStory(ai.db, bookId);
  let folded = 0;
  for (const state of story.scenes) {
    const waiting = state.scene.status === 'ended' && state.unfolded.length > 0;
    if (waiting) {
      await foldScene(ai, state.scene.id);
      folded += 1;
    }
  }
  return folded;
}

/**
 * The last of the scene's turns to fold so that at least `excess` tokens leave the context,
 * keeping the latest KEEP_TURNS. Null when there's nothing it may fold.
 */
export function foldPoint(turns: Turn[], excess: number): number | null {
  const foldable = turns.slice(0, Math.max(0, turns.length - KEEP_TURNS));
  if (foldable.length === 0) {
    return null;
  }
  let freed = 0;
  for (const turn of foldable) {
    freed += estimateTextTokens(turn.input) + estimateTextTokens(turn.reply);
    if (freed >= excess) {
      return turn.number;
    }
  }
  return foldable[foldable.length - 1].number;
}

/** Where the story stands against its budget after fitting. */
export interface Fit {
  tokens: number;
  budget: number;
  /** Turns of the scene being played folded to fit. */
  folded: number;
}

/**
 * Before a call: folds any ended scene still waiting, then, if the story is over its budget, the
 * oldest turns of the scene being played, until it's comfortably under. Says so in the log if
 * it's still over, which only the latest turns or the story's own size can make it.
 */
export async function fitBudget(ai: Folding, bookId: string): Promise<Fit> {
  await foldEnded(ai, bookId);
  const budget = budgetFor(ai.inUse.model);
  const story = await readStory(ai.db, bookId);
  const tokens = contextTokens(storyView(story));
  if (tokens <= budget) {
    return { tokens, budget, folded: 0 };
  }

  const playing = story.scenes.find((state) => state.scene.status === 'playing');
  let through: number | null = null;
  if (playing) {
    const target = Math.floor(budget * FOLD_TO);
    through = foldPoint(playing.unfolded, tokens - target);
  }
  if (!playing || through === null) {
    log.warn({ bookId, tokens, budget }, 'the story is over its budget with nothing left to fold');
    return { tokens, budget, folded: 0 };
  }

  await foldTurns(ai, playing.scene.id, through);
  const folded = playing.unfolded.filter((turn) => turn.number <= through).length;
  const after = contextTokens(storyView(await readStory(ai.db, bookId)));
  if (after > budget) {
    log.warn({ bookId, tokens: after, budget }, 'the story is still over its budget after folding');
  }
  return { tokens: after, budget, folded };
}
