import type { Message, UserMessage } from '@writer/pi-ai';
import { ModelError, type Role } from '../ai/call.ts';
import type { Db, Tx } from '../db/client.ts';
import { log } from '../log.ts';
import { StoryError } from '../story/changes.ts';
import type { Scene } from '../story/scenes.ts';
import { addMessage, currentSegment, startSegment, type Segment, type SessionMessage } from '../story/session.ts';
import { headFor } from './brief.ts';
import { compact, compactAt, FoldError, wrapUpEnded } from './folds.ts';
import { noOutcome, toolsFor } from './play.ts';
import { exchange, sessionContext, sessionTokens, type Answer, type Ask, type Procreator } from './run.ts';

/*
 * The way into a scene's session for play. The session opens with a brief the first time, every
 * earlier scene wrapped up first so the brief holds them all; a session past its limit is compacted
 * before the message goes; then the message is sent, and Procreator answers.
 */

/** How a message goes: as play (the default), or as an aside, like hints, never sent again. */
export interface Asking {
  mode?: 'play' | 'hints';
  kind?: 'play' | 'aside';
  role?: Role;
  onText?: Ask['onText'];
  onScene?: Ask['onScene'];
}

/** Opens the scene's session: the brief, built once the scenes before are all wrapped up. */
async function openSession(ai: Procreator, scene: Scene): Promise<Segment> {
  await wrapUpEnded(ai, scene.bookId);
  const head = await headFor(ai.db, scene, '');
  // Made at no turn, so an undo never cuts the brief the session opened with.
  return startSegment(ai.db, scene, { head, summary: '', fromSeq: 1, turnId: null });
}

/** The segment to send in: this one, or a new one when the session has grown past its limit and could be compacted. */
async function fit(ai: Procreator, scene: Scene, segment: Segment, text: string, turnId: string | null): Promise<Segment> {
  const tools = toolsFor({ db: ai.db, scene, turnId, mode: 'play', outcome: noOutcome(), onScene: () => {} });
  const context = await sessionContext(ai.db, scene, segment, tools);
  const next: UserMessage = { role: 'user', content: text, timestamp: Date.now() };
  const tokens = sessionTokens([...(context.messages as Message[]), next]);
  const limit = compactAt(ai.inUse.model);
  if (tokens <= limit) {
    return segment;
  }
  try {
    const compacted = await compact(ai, scene, segment, turnId);
    if (compacted) {
      return compacted;
    }
    log.warn({ sceneId: scene.id, tokens, limit }, 'the session is over its limit with nothing left to fold');
    return segment;
  } catch (err) {
    // The session still fits the model's window (its limit leaves room), so play goes on uncompacted.
    if (err instanceof FoldError || err instanceof ModelError) {
      log.warn({ sceneId: scene.id, tokens, limit, err: err.message }, 'compaction failed, so the session goes on as it was');
      return segment;
    }
    throw err;
  }
}

/** Sends a message in the scene's session, at a turn, and gives back Procreator's answer. */
export async function converse(ai: Procreator, scene: Scene, text: string, turnId: string | null, asking: Asking = {}): Promise<Answer> {
  if (scene.status !== 'playing') {
    throw new StoryError(`Scene ${scene.number} isn't being played, so it takes no turns.`);
  }
  let segment = await currentSegment(ai.db, scene.id);
  if (!segment) {
    segment = await openSession(ai, scene);
  }
  segment = await fit(ai, scene, segment, text, turnId);
  const ask: Ask = {
    text,
    turnId,
    kind: asking.kind ?? 'play',
    role: asking.role ?? 'narrator',
    mode: asking.mode ?? 'play',
    onText: asking.onText,
    onScene: asking.onScene,
  };
  return exchange(ai, scene, segment, ask);
}

/**
 * Asks Procreator for openings for the story's first scene, in its session, which opens for it
 * before the scene begins: the call that opens the scene starts the same, and the cache holds it.
 */
export async function askForOpenings(ai: Procreator, scene: Scene, text: string): Promise<Answer> {
  let segment = await currentSegment(ai.db, scene.id);
  if (!segment) {
    segment = await openSession(ai, scene);
  }
  return exchange(ai, scene, segment, { text, turnId: null, kind: 'aside', role: 'openings', mode: 'openings' });
}

/** Tells Procreator of a change the owner made mid scene: a note at the end of the session, read with the next message. */
export async function addNote(db: Db | Tx, scene: Scene, turnId: string | null, text: string): Promise<SessionMessage> {
  const note: UserMessage = { role: 'user', content: text, timestamp: Date.now() };
  return addMessage(db, scene, 'note', turnId, note);
}
