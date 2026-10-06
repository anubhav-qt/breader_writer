import { estimateMessageTokens, type Api, type Model } from '@writer/pi-ai';
import { and, asc, eq } from 'drizzle-orm';
import { scenes } from '../db/schema.ts';
import { render } from '../prompts/render.ts';
import { edit, startChange, StoryError } from '../story/changes.ts';
import { lastTurns } from '../story/read.ts';
import type { Scene } from '../story/scenes.ts';
import { currentSegment, segmentMessages, startSegment, type Numbered, type Segment } from '../story/session.ts';
import { headFor } from './brief.ts';
import { exchange, type Answer, type Procreator } from './run.ts';

/*
 * Our compaction, made for the story: folds. Save first, trim second. Procreator, in the scene's
 * own session (so it has the scene in view, and in the cache), first saves to the reference and its
 * memory what the turns established, then writes a summary; only then do the turns leave what the
 * model is sent, and they stay kept word for word in the session all the same. A fold that fails
 * trims nothing; what it saved stays saved.
 *
 * - The wrap-up, at every scene's end: everything the scene established is saved, then its
 *   summary is written, which every brief from then on holds. Then the session closes.
 * - Compaction, mid scene, as a safety net: past its limit, the session's older turns fold into
 *   the scene so far, and a new segment opens with a fresh brief, that summary, and the latest
 *   turns word for word. The cut falls only between turns, so a move, its reply and their tool
 *   calls stay together.
 */

/** A session is compacted past this many tokens, or sooner on a model whose window can't take that and an answer. */
export const COMPACT_AT = 400_000;
/** After a compaction, the latest turns kept word for word take up to this share of the limit. */
const KEEP_SHARE = 0.2;

/** A fold that couldn't be kept: no summary, and nothing trimmed. */
export class FoldError extends Error {}

/** Where a model's sessions are compacted. */
export function compactAt(model: Model<Api>): number {
  let room = model.contextWindow - model.maxTokens;
  if (room < model.contextWindow / 2) {
    // A model that can answer with most of its window gets half of it for the session.
    room = Math.floor(model.contextWindow / 2);
  }
  return Math.min(COMPACT_AT, room);
}

/** One turn's messages in a session, together. */
export interface TurnRun {
  turn: number | null;
  /** Its first message. */
  firstSeq: number;
  tokens: number;
}

/** Whether a message goes with a turn's run: it's that turn's, or it has no turn of its own. */
function belongsTo(message: Numbered, run: TurnRun): boolean {
  if (message.turn === null) {
    return true;
  }
  return message.turn === run.turn;
}

/** The segment's messages, a run per turn. */
function runsOf(messages: Numbered[]): TurnRun[] {
  const runs: TurnRun[] = [];
  for (const each of messages) {
    const tokens = estimateMessageTokens(each.message);
    const last = runs.at(-1);
    if (last !== undefined && belongsTo(each, last)) {
      last.tokens += tokens;
    } else {
      runs.push({ turn: each.turn, firstSeq: each.row.seq, tokens });
    }
  }
  return runs;
}

/** Where a compaction cuts the session: the turns that fold, and those kept word for word after them. */
export interface Cut {
  /** The first message kept. */
  fromSeq: number;
  folded: TurnRun[];
  kept: TurnRun[];
}

/**
 * Where to cut: the newest turns are kept while they fit in `keep` tokens, the latest always, and
 * the turns before them fold. Null when there's no turn before them to fold.
 */
export function cutPoint(messages: Numbered[], keep: number): Cut | null {
  const runs = runsOf(messages);
  if (runs.length < 2) {
    return null;
  }
  let first = runs.length - 1;
  let tokens = runs[first].tokens;
  // Stops at 1, so the oldest turn always folds.
  while (first > 1) {
    const older = runs[first - 1];
    if (tokens + older.tokens > keep) {
      break;
    }
    tokens += older.tokens;
    first -= 1;
  }
  return { fromSeq: runs[first].firstSeq, folded: runs.slice(0, first), kept: runs.slice(first) };
}

/** What the compaction's request takes (prompts/templates/procreator/compact.njk). */
export interface CompactPrompt {
  scene: number;
  /** The turns that fold, first and last. */
  from: number;
  to: number;
  /** The first turn kept word for word. */
  keptFrom: number;
  /** Whether the segment has a scene so far already, which the new one keeps. */
  earlier: boolean;
}

function turnsIn(runs: TurnRun[]): number[] {
  const numbers: number[] = [];
  for (const run of runs) {
    if (run.turn !== null) {
      numbers.push(run.turn);
    }
  }
  return numbers;
}

/** The compaction's request, or null when the cut has no turns to name. */
export function compactPrompt(scene: Scene, segment: Segment, cut: Cut): CompactPrompt | null {
  const folded = turnsIn(cut.folded);
  const kept = turnsIn(cut.kept);
  if (folded.length === 0 || kept.length === 0) {
    return null;
  }
  return {
    scene: scene.number,
    from: folded[0],
    to: folded[folded.length - 1],
    keptFrom: kept[0],
    earlier: segment.summary !== '',
  };
}

/** A summary Procreator wrote, or why it can't be kept. */
function summaryFrom(answer: Answer, what: string): string {
  if (answer.stopReason === 'length') {
    throw new FoldError(`The ${what} was cut off, so nothing was trimmed.`);
  }
  if (!answer.text) {
    throw new FoldError(`Procreator wrote no ${what}, so nothing was trimmed.`);
  }
  return answer.text;
}

/**
 * Compacts the scene's session: Procreator saves what the older turns established, then writes the
 * scene so far, and a new segment opens with a fresh brief, that summary and the latest turns.
 * Null when there was nothing to fold.
 */
export async function compact(ai: Procreator, scene: Scene, segment: Segment, turnId: string | null): Promise<Segment | null> {
  const messages = await segmentMessages(ai.db, segment);
  const keep = Math.floor(compactAt(ai.inUse.model) * KEEP_SHARE);
  const cut = cutPoint(messages, keep);
  if (!cut) {
    return null;
  }
  const prompt = compactPrompt(scene, segment, cut);
  if (!prompt) {
    return null;
  }
  const text = render('procreator/compact.njk', prompt);
  const answer = await exchange(ai, scene, segment, { text, kind: 'fold', role: 'fold', turnId });
  const summary = summaryFrom(answer, 'scene so far');
  const head = await headFor(ai.db, scene, summary);
  return startSegment(ai.db, scene, { head, summary, fromSeq: cut.fromSeq, turnId });
}

/**
 * Wraps up an ended scene in its session: Procreator saves everything the scene established, then
 * writes its summary, kept as a change. A scene wrapped up already is left as it is.
 */
export async function wrapUp(ai: Procreator, scene: Scene): Promise<Scene> {
  if (scene.status !== 'ended') {
    throw new StoryError(`Scene ${scene.number} is still playing. End it before it's wrapped up.`);
  }
  if (scene.summary) {
    return scene;
  }
  const [last] = await lastTurns(ai.db, scene.id, 1);
  let turnId: string | null = null;
  if (last) {
    turnId = last.id;
  }
  let segment = await currentSegment(ai.db, scene.id);
  if (!segment) {
    // A scene that ended with nothing played still needs the story in view to be summed up.
    const head = await headFor(ai.db, scene, '');
    segment = await startSegment(ai.db, scene, { head, summary: '', fromSeq: 1, turnId: null });
  }
  const text = render('procreator/wrap.njk', { scene: scene.number });
  const answer = await exchange(ai, scene, segment, { text, kind: 'fold', role: 'fold', turnId });
  const summary = summaryFrom(answer, `summary of scene ${scene.number}`);

  return ai.db.transaction(async (tx) => {
    const [current] = await tx.select().from(scenes).where(eq(scenes.id, scene.id)).for('update');
    if (current.summary) {
      return current;
    }
    const change = await startChange(tx, { bookId: scene.bookId, turnId, by: 'agent', what: `Wrapped up scene ${scene.number}` });
    return edit(tx, change, scenes, { id: scene.id }, { summary });
  });
}

/** Wraps up the book's ended scenes still waiting for it, oldest first, as when a wrap-up failed. */
export async function wrapUpEnded(ai: Procreator, bookId: string): Promise<number> {
  const waiting = await ai.db
    .select()
    .from(scenes)
    .where(and(eq(scenes.bookId, bookId), eq(scenes.status, 'ended'), eq(scenes.summary, '')))
    .orderBy(asc(scenes.number));
  for (const scene of waiting) {
    await wrapUp(ai, scene);
  }
  return waiting.length;
}
