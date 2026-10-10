import type { Api, AssistantMessage, Message, Model, UserMessage } from '@writer/pi-ai';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../db/client.ts';
import { sessionMessages, turns } from '../db/schema.ts';
import { render } from '../prompts/render.ts';
import { actorSegmentMessages, addActorMessage, currentActorSegment, nextActorSeq, startActorSegment } from '../story/actors.ts';
import { isStanding } from '../story/cast.ts';
import { messageText, sessionGoesOn } from '../story/passages.ts';
import { readStory, type Story } from '../story/read.ts';
import type { Scene, Turn } from '../story/scenes.ts';
import { addMessage, currentSegment, nextSeq, startSegment } from '../story/session.ts';
import { actorHeadView, selfView } from '../story/view.ts';
import { headFor, turnMessage } from './brief.ts';
import type { Rewritten } from './rewrite.ts';

/*
 * After the owner's change reaches back, the working copies that will be sent again start afresh
 * from the story as it now reads (see "Changing the past" in CLAUDE.md). A scene session that goes
 * on (the scene being played, or one that ended and waits for its wrap-up) gets a new segment with
 * a fresh brief, then its turns again as plain messages, since their tool calls and thinking don't
 * survive a rewrite, with the owner's notes where they were. Each actor gets a new segment with who
 * they are now, then their chat again, rewritten. Every new segment is made at no turn, so an undo
 * leaves it, and every message keeps its turn, so an undo still cuts it.
 */

/** The working copies' new words, by where they're kept. */
export interface Copies {
  notes: Map<number, string>;
  actors: Map<number, string>;
  memories: Map<number, string>;
}

/** The working copies Procreator rewrote, apart from the story's own passages. */
export function copiesOf(rewritten: Rewritten[]): Copies {
  const copies: Copies = { notes: new Map(), actors: new Map(), memories: new Map() };
  for (const each of rewritten) {
    const spot = each.passage.spot;
    if (spot.kind === 'note') {
      copies.notes.set(spot.id, each.text);
    } else if (spot.kind === 'actor') {
      copies.actors.set(spot.id, each.text);
    } else if (spot.kind === 'memory') {
      copies.memories.set(spot.id, each.text);
    }
  }
  return copies;
}

function userSays(text: string): UserMessage {
  return { role: 'user', content: text, timestamp: Date.now() };
}

/** Words as Procreator's, for a session it didn't write them in: plain text, with no account of tokens. */
function procreatorSays(model: Model<Api>, text: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop',
    timestamp: Date.now(),
  };
}

/** A scene's session starts again from its turns as they read now, and its notes, in the order they came. */
async function restartSession(tx: Tx, model: Model<Api>, scene: Scene, notes: Map<number, string>) {
  if (!(await currentSegment(tx, scene.id))) {
    return;
  }
  const kept = await tx
    .select()
    .from(sessionMessages)
    .where(and(eq(sessionMessages.sceneId, scene.id), eq(sessionMessages.undone, false), inArray(sessionMessages.kind, ['play', 'note'])))
    .orderBy(asc(sessionMessages.seq));
  const standing = await tx
    .select()
    .from(turns)
    .where(and(eq(turns.sceneId, scene.id), eq(turns.undone, false)));
  const turnsById = new Map<string, Turn>(standing.map((turn) => [turn.id, turn]));

  const head = await headFor(tx, scene, '');
  const fromSeq = await nextSeq(tx, scene.id);
  await startSegment(tx, scene, { head, summary: '', fromSeq, turnId: null });
  const told = new Set<string>();
  for (const row of kept) {
    if (row.kind === 'note') {
      const text = notes.get(row.id) ?? messageText(row.message as Message);
      await addMessage(tx, scene, 'note', null, userSays(text));
      continue;
    }
    const turn = row.turnId ? turnsById.get(row.turnId) : undefined;
    if (!turn || told.has(turn.id)) {
      continue;
    }
    told.add(turn.id);
    await addMessage(tx, scene, 'play', turn.id, userSays(await turnMessage(tx, scene, turn)));
    if (turn.reply) {
      await addMessage(tx, scene, 'play', turn.id, procreatorSays(model, turn.reply));
    }
  }
}

/** A message of an actor's chat as it reads now: its new words, or as it was. */
function copied(message: Message, text: string | undefined): Message {
  if (text === undefined) {
    return message;
  }
  if (message.role === 'assistant') {
    return { ...message, content: [{ type: 'text', text }] };
  }
  return userSays(text);
}

/** An actor's chat starts again: who they are now, what they remember, and their chat as it reads now. */
async function restartActor(tx: Tx, story: Story, characterId: string, copies: Copies) {
  const actor = { bookId: story.book.id, characterId };
  const segment = await currentActorSegment(tx, actor);
  if (!segment) {
    return;
  }
  const messages = await actorSegmentMessages(tx, segment);
  const self = render('actor/self.njk', selfView(story, characterId));
  const memory = copies.memories.get(segment.id) ?? segment.memory;
  const head = render('actor/head.njk', actorHeadView(story, self, memory));
  const fromSeq = await nextActorSeq(tx, actor);
  await startActorSegment(tx, actor, { head, self, memory, fromSeq, turnId: null });
  for (const each of messages) {
    const message = copied(each.message, copies.actors.get(each.row.id));
    await addActorMessage(tx, actor, { kind: 'play', turnId: each.row.turnId, sceneId: each.row.sceneId, message, self: null });
  }
}

/** Every session and actor's chat that will be sent again starts afresh from the story as it now reads. */
export async function restartCopies(tx: Tx, bookId: string, model: Model<Api>, copies: Copies) {
  const story = await readStory(tx, bookId);
  for (const scene of story.scenes) {
    if (sessionGoesOn(scene)) {
      await restartSession(tx, model, scene, copies.notes);
    }
  }
  for (const person of story.characters) {
    if (isStanding(person)) {
      await restartActor(tx, story, person.id, copies);
    }
  }
}
