import {
  estimateContextTokens,
  estimateMessageTokens,
  normalizeContext,
  streamSimple,
  type Message,
  type TranscriptContext,
  type UserMessage,
} from '@writer/pi-ai';
import { counted, ModelError, recordCall, textOf, thinkingOf, type CallTag, type Role, type Sent } from '../ai/call.ts';
import { undashed } from '../ai/dashes.ts';
import type { Db } from '../db/client.ts';
import { log } from '../log.ts';
import { render } from '../prompts/render.ts';
import {
  actorSegmentMessages,
  addActorMessage,
  currentActorSegment,
  lastSceneOf,
  lastSelf,
  startActorSegment,
  type Actor,
  type ActorNumbered,
  type ActorSegment,
} from '../story/actors.ts';
import { StoryError } from '../story/changes.ts';
import { readStory } from '../story/read.ts';
import { sceneNow, type Scene } from '../story/scenes.ts';
import { actorHeadView, selfView } from '../story/view.ts';
import { compactAt, KEEP_SHARE } from './folds.ts';
import type { Procreator } from './run.ts';

/*
 * A cast member's actor at work (see "Actors" in CLAUDE.md). Procreator directs: when someone in
 * the cast is about to act, it cues their actor with what they see and know now, and the actor
 * answers what they do, say and think, in a chat of their own across every scene they're in.
 * Procreator writes the prose from the answer, and can send it back with a note.
 *
 * The chat holds only their side of the story. It opens with who they are (the owner's sheet,
 * Procreator's page about them, their own side of each relationship); when that changes, their
 * next cue tells them who they are now. Each call sends the chat as it stands with one message
 * more, so the cache holds, and keeps both once the actor has answered: a call that fails leaves
 * the chat as it was.
 */

/** Someone in the cast at a moment of a scene being played: who, where, and at which turn. */
export interface Moment {
  person: { id: string; name: string };
  scene: Scene;
  turnId: string;
}

function actorOf(moment: Moment): Actor {
  return { bookId: moment.scene.bookId, characterId: moment.person.id };
}

/** Who they are now, as their chat tells them (prompts/templates/actor/self.njk). */
async function selfNow(db: Db, actor: Actor): Promise<string> {
  const story = await readStory(db, actor.bookId);
  return render('actor/self.njk', selfView(story, actor.characterId));
}

/** A new segment of the actor's chat: who they are now, and what they remember from before. */
async function openSegment(db: Db, actor: Actor, opening: { memory: string; fromSeq: number; turnId: string }): Promise<ActorSegment> {
  const story = await readStory(db, actor.bookId);
  const self = render('actor/self.njk', selfView(story, actor.characterId));
  const head = render('actor/head.njk', actorHeadView(story, self, opening.memory));
  return startActorSegment(db, actor, { head, self, ...opening });
}

/**
 * The actor's chat as it stands, opened the first time they're cued. It's made at that turn, so
 * an undo past it starts the chat afresh, from who they are then.
 */
async function chatOf(db: Db, moment: Moment): Promise<ActorSegment> {
  const actor = actorOf(moment);
  const segment = await currentActorSegment(db, actor);
  if (segment) {
    return segment;
  }
  return openSegment(db, actor, { memory: '', fromSeq: 1, turnId: moment.turnId });
}

/** The actor's chat as the model is sent it: their instructions, the segment's head, its messages, then one more. */
async function chatContext(db: Db, segment: ActorSegment, name: string, next: UserMessage | null): Promise<TranscriptContext> {
  const head: UserMessage = { role: 'user', content: segment.head, timestamp: segment.createdAt.getTime() };
  const messages: Message[] = [head];
  for (const each of await actorSegmentMessages(db, segment)) {
    messages.push(each.message);
  }
  if (next) {
    messages.push(next);
  }
  return normalizeContext({ systemPrompt: render('actor/system.njk', { name }), messages });
}

/** One call in the actor's chat: the chat as it stands and the message, and the answer's words, or a ModelError. */
async function call(ai: Procreator, moment: Moment, segment: ActorSegment, message: UserMessage, role: Role) {
  const context = await chatContext(ai.db, segment, moment.person.name, message);
  const sent: Sent = { startedAt: new Date(), estimate: counted(context.messages) };
  const stream = streamSimple(
    ai.inUse.model,
    context,
    {
      reasoning: thinkingOf(ai.inUse),
      apiKey: ai.inUse.apiKey,
      signal: ai.signal,
      // Keeps the actor's calls on one cache where the provider keys its cache by session, and
      // asks for it to last, since an actor is often cued only once or twice a scene.
      sessionId: `actor-${moment.person.id}`,
      cacheRetention: 'long',
    },
  );
  const answer = await stream.result();
  const tag: CallTag = { userId: ai.userId, bookId: moment.scene.bookId, sceneId: moment.scene.id, turnId: moment.turnId, role };
  await recordCall(ai.db, tag, ai.inUse, sent, answer);
  if (answer.stopReason === 'error' || answer.stopReason === 'aborted') {
    throw new ModelError(answer.errorMessage ?? `${moment.person.name}’s actor didn’t answer.`);
  }
  const words = undashed(textOf(answer).trim());
  if (words === '') {
    throw new ModelError(`${moment.person.name}’s actor didn’t answer.`);
  }
  return { answer, words };
}

/** What a message to the actor says: who they are now if that changed, the scene if it's new to them, and what they see. */
async function cueOf(db: Db, segment: ActorSegment, moment: Moment, sees: string, did: string): Promise<{ text: string; self: string | null }> {
  const actor = actorOf(moment);
  const now = await selfNow(db, actor);
  let news = '';
  let self: string | null = null;
  if (now !== (await lastSelf(db, segment))) {
    news = now;
    self = now;
  }
  let scene: { number: number; place: string; time: string } | null = null;
  if ((await lastSceneOf(db, actor)) !== moment.scene.id) {
    // Read again: the scene may have been set since the run began.
    const current = await sceneNow(db, moment.scene.id);
    scene = { number: current.number, place: current.place, time: current.time };
  }
  const text = render('actor/cue.njk', { news, scene, sees, did });
  return { text, self };
}

function userMessage(text: string): UserMessage {
  return { role: 'user', content: text, timestamp: Date.now() };
}

/** Cues the actor with what they see and know now, and gives their answer: what they do, say and think. */
export async function cueActor(ai: Procreator, moment: Moment, sees: string): Promise<string> {
  const segment = await fitted(ai, moment, await chatOf(ai.db, moment));
  const cue = await cueOf(ai.db, segment, moment, sees, '');
  const message = userMessage(cue.text);
  const { answer, words } = await call(ai, moment, segment, message, 'actor');
  const actor = actorOf(moment);
  const at = { kind: 'play' as const, turnId: moment.turnId, sceneId: moment.scene.id };
  await addActorMessage(ai.db, actor, { ...at, message, self: cue.self });
  await addActorMessage(ai.db, actor, { ...at, message: answer, self: null });
  return words;
}

/** Sends the actor's answer at this turn back with a note on the character, and gives their new answer. */
export async function sendBack(ai: Procreator, moment: Moment, note: string): Promise<string> {
  const segment = await currentActorSegment(ai.db, actorOf(moment));
  let last: ActorNumbered | undefined;
  if (segment) {
    last = (await actorSegmentMessages(ai.db, segment)).at(-1);
  }
  if (!segment || !last || last.row.turnId !== moment.turnId || last.message.role !== 'assistant') {
    throw new StoryError(`${moment.person.name}’s actor hasn’t answered a cue this turn, so there’s nothing to send back. Cue them instead.`);
  }
  const message = userMessage(render('actor/director.njk', { note }));
  const { answer, words } = await call(ai, moment, segment, message, 'actor');
  const actor = actorOf(moment);
  const at = { kind: 'play' as const, turnId: moment.turnId, sceneId: moment.scene.id, self: null };
  await addActorMessage(ai.db, actor, { ...at, message });
  await addActorMessage(ai.db, actor, { ...at, message: answer });
  return words;
}

/**
 * Tells the actor what the owner played them doing, when the owner played them this time: what
 * they saw, then what they did, as theirs. Nothing is asked of the model.
 */
export async function tellActor(ai: Procreator, moment: Moment, sees: string, did: string): Promise<void> {
  const segment = await fitted(ai, moment, await chatOf(ai.db, moment));
  const cue = await cueOf(ai.db, segment, moment, sees, did);
  const at = { kind: 'play' as const, turnId: moment.turnId, sceneId: moment.scene.id };
  await addActorMessage(ai.db, actorOf(moment), { ...at, message: userMessage(cue.text), self: cue.self });
}

// Compaction.

/** One scene's messages in an actor's chat. */
interface SceneRun {
  sceneId: string;
  firstSeq: number;
  tokens: number;
}

function runsOf(messages: ActorNumbered[]): SceneRun[] {
  const runs: SceneRun[] = [];
  for (const each of messages) {
    const tokens = estimateMessageTokens(each.message);
    const last = runs.at(-1);
    if (last !== undefined && last.sceneId === each.row.sceneId) {
      last.tokens += tokens;
    } else {
      runs.push({ sceneId: each.row.sceneId, firstSeq: each.row.seq, tokens });
    }
  }
  return runs;
}

/**
 * Where a compaction cuts the actor's chat: the newest scenes that fit in `keep` tokens stay word
 * for word, and the ones before fold. Only scenes that are wrapped up fold, so Procreator has saved
 * what they established to the reference, their page included, before they leave the chat; the
 * scene being played never is. The cut is the first message kept (or the next one, when everything
 * folds) and the scene the chat goes on from. Null when nothing can fold.
 */
async function actorCut(db: Db, messages: ActorNumbered[], keep: number, now: Scene): Promise<{ fromSeq: number; from: Scene } | null> {
  const runs = runsOf(messages);
  let first = runs.length;
  let kept = 0;
  while (first > 0 && kept + runs[first - 1].tokens <= keep) {
    first -= 1;
    kept += runs[first].tokens;
  }
  // A scene that isn't wrapped up yet can't fold, so the cut comes before it.
  for (let index = 0; index < first; index += 1) {
    const scene = await sceneNow(db, runs[index].sceneId);
    if (scene.summary === '') {
      first = index;
      break;
    }
  }
  if (first === 0) {
    return null;
  }
  if (first === runs.length) {
    const last = messages[messages.length - 1];
    return { fromSeq: last.row.seq + 1, from: await sceneNow(db, now.id) };
  }
  return { fromSeq: runs[first].firstSeq, from: await sceneNow(db, runs[first].sceneId) };
}

/**
 * The segment to send in: this one, or past its limit, a new one. The actor writes what they
 * remember of the scenes that fold, in their own voice, in the chat with everything in view; the
 * new segment opens with who they are now and that memory, then the kept scenes word for word.
 * A fold that fails trims nothing, and the chat goes on as it was.
 */
async function fitted(ai: Procreator, moment: Moment, segment: ActorSegment): Promise<ActorSegment> {
  const limit = compactAt(ai.inUse.model);
  const context = await chatContext(ai.db, segment, moment.person.name, null);
  if (estimateContextTokens(context.messages).tokens <= limit) {
    return segment;
  }
  const kept = await actorSegmentMessages(ai.db, segment);
  const cut = await actorCut(ai.db, kept, Math.floor(limit * KEEP_SHARE), moment.scene);
  if (!cut) {
    log.warn({ characterId: moment.person.id, limit }, 'an actor’s chat is over its limit with nothing it can fold');
    return segment;
  }
  const ask = render('actor/fold.njk', { name: moment.person.name, from: cut.from.number, remembered: segment.memory !== '' });
  const message = userMessage(ask);
  try {
    const { answer, words } = await call(ai, moment, segment, message, 'fold');
    const actor = actorOf(moment);
    const at = { kind: 'fold' as const, turnId: moment.turnId, sceneId: moment.scene.id, self: null };
    await addActorMessage(ai.db, actor, { ...at, message });
    await addActorMessage(ai.db, actor, { ...at, message: answer });
    return await openSegment(ai.db, actor, { memory: words, fromSeq: cut.fromSeq, turnId: moment.turnId });
  } catch (err) {
    if (err instanceof ModelError) {
      log.warn({ characterId: moment.person.id, err: err.message }, 'an actor’s compaction failed, so the chat goes on as it was');
      return segment;
    }
    throw err;
  }
}
