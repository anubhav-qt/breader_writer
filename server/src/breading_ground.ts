import { eq } from 'drizzle-orm';
import type { Api, Model } from '@writer/pi-ai';
import type { Reach, StoryEdit } from '@writer/shared/story';
import { undashed } from './ai/dashes.ts';
import type { Db, Tx } from './db/client.ts';
import { books } from './db/schema.ts';
import { castByName, castOf, joinCast as castJoin, standingOf, type CharacterRow, type Newcomer } from './story/cast.ts';
import { standingAt, startChange, StoryError, takeBack, type Change, type Writer } from './story/changes.ts';
import { forget as forgetNote, remember as rememberNote, type Note } from './story/memory.ts';
import { editPage as pageEdit, writePage as pageWrite, type PageEdit, type PageWrite, type Written } from './story/pages.ts';
import { shiftOnce, type HistoryEntry, type Shift, type SideShift } from './story/relationships.ts';
import {
  addTurn as turnAdd,
  beginScene as sceneBegin,
  endScene as sceneEnd,
  lockedScene,
  markUndone,
  newestInBook,
  nextScene,
  playingScene,
  prepareScene,
  reframeScene,
  sceneNow,
  setInput,
  setReply as replySet,
  summarize as sceneSummarize,
  type Cue,
  type Opening,
  type Scene,
  type Turn,
  type Voice,
} from './story/scenes.ts';
import { headFor } from './procreator/brief.ts';
import { render } from './prompts/render.ts';
import { cutActors } from './story/actors.ts';
import { changeNoteView, type ChangeNoteView } from './story/edits.ts';
import { rewritePassage } from './story/passages.ts';
import { copiesOf, restartCopies } from './procreator/rebuild.ts';
import type { Rewritten } from './procreator/rewrite.ts';
import { readStory, type Story } from './story/read.ts';
import { addMessage, currentSegment, cutSession, nextSeq, startSegment } from './story/session.ts';
import {
  addPerson,
  changeBook,
  changeLine,
  changeSheet,
  changeWorld,
  leaveCast,
  removePerson,
  untie,
} from './story/sheets.ts';

/*
 * breading_ground: the one door for changes to the story (the owner's design, 2026-10-07). It
 * keeps track of the whole book's state, and nothing else writes it: Procreator's tools, the
 * owner's edits and play itself all ask here. Each change is written through the change log
 * (story/changes.ts), which keeps what it was before, so it can be looked over and taken back;
 * then every part that depends on it is told, so it can make its own change. What depends on
 * what, so far:
 *
 * - a turn taken back: what Procreator changed at it is taken back, and the scene's session and
 *   every actor's chat are cut back to before it, so the next call is sent as if it never
 *   happened.
 * - someone's sheet, page or relationships changed: their actor is told who they are now with
 *   their next cue (procreator/actor.ts compares what it last told them with what stands).
 * - the owner changed the story mid play, from now on: Procreator is told with a note at the end
 *   of the scene's session, what changed and what it was. Before anything is played, the session
 *   (if the first scene's has opened) starts again from a fresh brief instead.
 *
 * Everything Procreator writes comes through without dashes (ai/dashes.ts). The story's own
 * modules (story/) do the writing; only this file calls their writes, which a test holds it to.
 */

/** Where a scene opens and when, and who is in it, by id. */
export type Frame = Opening;

/** One of the openings Procreator offers for the story's first scene, with where, when and who. */
export interface Offer extends Frame {
  /** A line or two, as the owner reads it. */
  text: string;
}

/** Text as the story keeps it: Procreator's without dashes, the owner's as they wrote it. */
function kept(writer: Writer, text: string): string {
  if (writer.by === 'agent') {
    return undashed(text);
  }
  return text;
}

/** Text that may be left out, kept as kept() keeps it. */
function keptIfGiven(writer: Writer, text: string | undefined): string | undefined {
  if (text === undefined) {
    return undefined;
  }
  return kept(writer, text);
}

// The reference and Procreator's memory.

/** Makes a page of the reference, or replaces all of one. */
export async function writePage(tx: Tx, writer: Writer, write: PageWrite): Promise<Written> {
  return pageWrite(tx, writer, { ...write, about: kept(writer, write.about), body: kept(writer, write.body) });
}

/** Changes part of a page, or adds to its end. */
export async function editPage(tx: Tx, writer: Writer, change: PageEdit): Promise<Written> {
  return pageEdit(tx, writer, { ...change, replace: kept(writer, change.replace) });
}

/** Keeps a note in Procreator's memory. */
export async function remember(tx: Tx, writer: Writer, text: string): Promise<{ note: Note; made: boolean }> {
  return rememberNote(tx, writer, kept(writer, text));
}

/** Drops a note from Procreator's memory. */
export async function forget(tx: Tx, writer: Writer, id: number): Promise<Note> {
  return forgetNote(tx, writer, id);
}

/** Shifts a relationship, once: the same shift again does nothing (null). */
export async function shiftRelationship(tx: Tx, writer: Writer, sceneId: string | null, shift: Shift): Promise<HistoryEntry | null> {
  const sides: SideShift[] = [];
  for (const side of shift.sides ?? []) {
    sides.push({ id: side.id, sees: keptIfGiven(writer, side.sees), hides: keptIfGiven(writer, side.hides) });
  }
  const clean: Shift = { ...shift, bond: keptIfGiven(writer, shift.bond), sides, what: kept(writer, shift.what) };
  return shiftOnce(tx, writer, sceneId, clean);
}

// Scenes.

/** The story's first scene, made to wait while the owner picks how it opens. Everyone is in it until then. */
export async function prepareFirstScene(tx: Tx, writer: Writer): Promise<Scene> {
  const cast = standingOf(await castOf(tx, writer.bookId));
  const present = cast.map((person) => person.id);
  const change = await startChange(tx, { ...writer, what: 'Made the first scene' });
  return prepareScene(tx, change, { place: '', time: '', present });
}

/** The openings Procreator offers for the first scene, kept with it until the owner picks one. */
export async function offerOpenings(tx: Tx, writer: Writer, scene: Scene, offers: Offer[]): Promise<Scene> {
  const openings: Offer[] = [];
  for (const offer of offers) {
    openings.push({
      text: kept(writer, offer.text),
      place: kept(writer, offer.place),
      time: kept(writer, offer.time),
      present: offer.present,
    });
  }
  const change = await startChange(tx, { ...writer, what: 'Offered openings for the first scene' });
  return reframeScene(tx, change, await sceneNow(tx, scene.id), { openings });
}

/** A frame as the story keeps it. */
function keptFrame(writer: Writer, frame: Frame): Frame {
  return { place: kept(writer, frame.place).trim(), time: kept(writer, frame.time).trim(), present: frame.present };
}

/** A scene waiting as next begins, opening as the frame says when one is given. */
export async function beginScene(tx: Tx, writer: Writer, scene: Scene, frame: Frame | null): Promise<Scene> {
  const change = await startChange(tx, { ...writer, what: `Began scene ${scene.number}` });
  const begun = await sceneBegin(tx, change, await sceneNow(tx, scene.id));
  if (!frame) {
    return begun;
  }
  return reframeScene(tx, change, begun, keptFrame(writer, frame));
}

/** Where and when a scene opens and who is in it, set whole, as when the owner picks how the story opens. */
export async function frameScene(tx: Tx, writer: Writer, scene: Scene, frame: Frame): Promise<Scene> {
  const change = await startChange(tx, { ...writer, what: `Framed scene ${scene.number}` });
  return reframeScene(tx, change, await sceneNow(tx, scene.id), keptFrame(writer, frame));
}

/** Where and when a scene is, and who has come into it, as one change, or nothing when it's so already. */
export interface Setting {
  place?: string;
  time?: string;
  /** Who comes into it, by id. No one leaves the list of who was in it. */
  joining?: string[];
}

/** Sets where and when the scene is, and who has come into it. */
export async function setScene(tx: Tx, writer: Writer, scene: Scene, setting: Setting): Promise<Scene> {
  const current = await sceneNow(tx, scene.id);
  const set: Partial<Frame> = {};
  const place = keptIfGiven(writer, setting.place);
  if (place !== undefined && place.trim() !== current.place) {
    set.place = place.trim();
  }
  const time = keptIfGiven(writer, setting.time);
  if (time !== undefined && time.trim() !== current.time) {
    set.time = time.trim();
  }
  const present = [...current.present];
  for (const id of setting.joining ?? []) {
    if (!present.includes(id)) {
      present.push(id);
    }
  }
  if (present.length > current.present.length) {
    set.present = present;
  }
  if (Object.keys(set).length === 0) {
    return current;
  }
  const change = await startChange(tx, { ...writer, what: `Set scene ${current.number}` });
  return reframeScene(tx, change, current, set);
}

/** The scene being played ends, and the next one waits for the owner, opening as the frame says. */
export async function endScene(tx: Tx, writer: Writer, scene: Scene, next: Frame): Promise<Scene> {
  const change = await startChange(tx, { ...writer, what: `Ended scene ${scene.number}` });
  await sceneEnd(tx, change, await sceneNow(tx, scene.id));
  return prepareScene(tx, change, keptFrame(writer, next));
}

/** An ended scene's summary, from its wrap-up. A scene summed up already stays as it is. */
export async function summarize(tx: Tx, writer: Writer, scene: Scene, summary: string): Promise<Scene> {
  const current = await lockedScene(tx, scene.id);
  if (current.summary) {
    return current;
  }
  const change = await startChange(tx, { ...writer, what: `Wrapped up scene ${scene.number}` });
  return sceneSummarize(tx, change, current, kept(writer, summary));
}

// The cast.

/** Someone new joins the cast, and the scene they come into. */
export async function joinCast(tx: Tx, writer: Writer, scene: Scene, newcomer: Newcomer): Promise<CharacterRow> {
  const sheet: Newcomer = {
    name: newcomer.name,
    who: kept(writer, newcomer.who),
    personality: kept(writer, newcomer.personality),
    past: kept(writer, newcomer.past),
  };
  const change = await startChange(tx, { ...writer, what: `${newcomer.name.trim()} joined the cast` });
  const person = await castJoin(tx, change, sheet);
  const current = await sceneNow(tx, scene.id);
  await reframeScene(tx, change, current, { present: [...current.present, person.id] });
  return person;
}

// Turns.

/** A new turn of the scene being played: the owner's move or note, or the scene's opening. */
export async function addTurn(db: Db, scene: Scene, voice: Voice, input: string, played: string | null): Promise<Turn> {
  const turn = await turnAdd(db, scene, voice, input, played);
  // The library shows the books played most recently first.
  await db.update(books).set({ updatedAt: new Date() }).where(eq(books.id, scene.bookId));
  return turn;
}

/** Procreator's narration for a turn, and the cue it stopped at for the owner, if it did. */
export async function setReply(db: Db, turn: Turn, reply: string, cue: Cue | null = null): Promise<Turn> {
  return replySet(db, turn, undashed(reply), cue);
}

/** An actor's turn's words: the actor's answer. */
export async function setActorAnswer(db: Db, turn: Turn, answer: string): Promise<Turn> {
  return setInput(db, turn, undashed(answer));
}

/**
 * Takes a turn back: what Procreator changed at it is taken back, newest first, and the turn is
 * kept but left out of the story. The scene's session and the actors' chats are told, and cut
 * everything sent and said at the turn, so the next call goes as if it never happened. What the
 * owner changed between turns stays.
 */
export async function takeBackTurn(db: Db, turn: Turn): Promise<void> {
  await db.transaction(async (tx) => {
    for (const change of await standingAt(tx, turn.id, 'agent')) {
      try {
        await takeBack(tx, change.id, { turnId: turn.id, by: 'owner' });
      } catch (err) {
        // Undo takes back the newest turn, so a later change in its way is one the owner made since.
        if (err instanceof StoryError) {
          throw new StoryError('Something you changed in the story since builds on what this turn did, so it can’t be taken back.');
        }
        throw err;
      }
    }
    await markUndone(tx, turn);
    await cutSession(tx, turn.sceneId, turn.number);
    await cutActors(tx, turn.sceneId, turn.number);
  });
}

// The owner's changes mid story, from the Story panel.

/** A sheet's name as the cast would keep it. */
function spacedName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/** A name the change gives someone in place of the one they had. */
export interface Rename {
  id: string;
  was: string;
  now: string;
}

/** The rename a change makes, if it makes one: a rename always reaches back. */
export function renameOf(story: Story, edit: StoryEdit): Rename | null {
  if (edit.kind !== 'sheet') {
    return null;
  }
  const before = story.characters.find((each) => each.id === edit.character.id);
  if (!before) {
    return null;
  }
  const name = spacedName(edit.character.name);
  if (name === '' || name === before.name) {
    return null;
  }
  return { id: before.id, was: before.name, now: name };
}

/** The change with the name left as it was: what of it holds from now on beside a rename. */
function withoutRename(story: Story, edit: StoryEdit): StoryEdit {
  const rename = renameOf(story, edit);
  if (!rename || edit.kind !== 'sheet') {
    return edit;
  }
  return { kind: 'sheet', character: { ...edit.character, name: rename.was } };
}

/**
 * Whether the rest of the change can reach back: the book's title and length never do (the pacing
 * follows a length from now on), nor someone joining, who joins from now on.
 */
function canReachBack(story: Story, edit: StoryEdit): boolean {
  if (edit.kind === 'join') {
    return false;
  }
  if (edit.kind !== 'book') {
    return changeNoteView(story, withoutRename(story, edit)).changed.length > 0;
  }
  const choices = edit.book;
  const world = story.world ?? { genre: '', tone: '', setting: '', rules: '', notes: '' };
  if (choices.pov !== story.book.pov || choices.darkness !== story.book.darkness) {
    return true;
  }
  const fields = ['genre', 'tone', 'setting', 'rules', 'notes'] as const;
  return fields.some((field) => choices.world[field].trim() !== world[field].trim());
}

/** What of a change reaches back into what was played: the rename it makes, and whether the rest holds always so. */
export interface Reaching {
  rename: Rename | null;
  always: boolean;
}

/** What of the change reaches back, or null when none of it does, as before anything is played. */
export function reachingOf(story: Story, edit: StoryEdit, reach: Reach, played: boolean): Reaching | null {
  if (!played) {
    return null;
  }
  const rename = renameOf(story, edit);
  const always = reach === 'always' && canReachBack(story, edit);
  if (!rename && !always) {
    return null;
  }
  return { rename, always };
}

/** What a change is, in a few words, for the change log and the quiet line a rewrite leaves. */
function whatOf(story: Story, edit: StoryEdit, played: boolean, reaching: Reaching | null): string {
  const names = new Map(story.characters.map((person) => [person.id, person.name]));
  if (edit.kind === 'sheet') {
    const rename = renameOf(story, edit);
    const rest = changeNoteView(story, withoutRename(story, edit)).changed.length > 0;
    if (rename && rest) {
      return `Renamed ${rename.was} ${rename.now}, and changed the sheet`;
    }
    if (rename) {
      return `Renamed ${rename.was} ${rename.now}`;
    }
    return `Changed ${names.get(edit.character.id) ?? 'someone'}’s sheet`;
  }
  if (edit.kind === 'join') {
    return `${edit.character.name.trim()} joined the cast`;
  }
  if (edit.kind === 'leave' && reaching?.always) {
    return `Wrote ${names.get(edit.id) ?? 'someone'} out of the story`;
  }
  if (edit.kind === 'leave' && played) {
    return `${names.get(edit.id) ?? 'Someone'} left the story`;
  }
  if (edit.kind === 'leave') {
    return `Took ${names.get(edit.id) ?? 'someone'} out of the story`;
  }
  if (edit.kind === 'line') {
    return `Changed the line between ${names.get(edit.relationship.a.id) ?? 'someone'} and ${names.get(edit.relationship.b.id) ?? 'someone'}`;
  }
  if (edit.kind === 'untie') {
    return `Untied ${names.get(edit.a) ?? 'someone'} and ${names.get(edit.b) ?? 'someone'}`;
  }
  return 'Changed the book';
}

/** Why the owner made it, as the change log keeps it. */
function whyOf(reach: Reach, reaching: Reaching | null): string {
  if (reach === 'always') {
    return 'always so';
  }
  if (reaching?.rename) {
    return 'renamed, and the rest from now on';
  }
  return 'from now on';
}

/** The change log's why for the passages a change rewrote, which the play's quiet lines look for. */
export const REWROTE = 'rewrote the past';

/**
 * Makes the change. Before anything is played there's no past to keep, and always so writes the
 * past again, so someone leaving is taken out altogether and an untied line takes its history with
 * it. From now on, they stay in what happened.
 */
async function applyEdit(tx: Tx, change: Change, edit: StoryEdit, keepsPast: boolean) {
  if (edit.kind === 'sheet') {
    await changeSheet(tx, change, edit.character);
  } else if (edit.kind === 'join') {
    await addPerson(tx, change, edit.character);
  } else if (edit.kind === 'leave' && keepsPast) {
    await leaveCast(tx, change, edit.id);
  } else if (edit.kind === 'leave') {
    await removePerson(tx, change, edit.id);
  } else if (edit.kind === 'line') {
    await changeLine(tx, change, edit.relationship);
  } else if (edit.kind === 'untie') {
    await untie(tx, change, edit.a, edit.b, !keepsPast);
  } else {
    const { world, ...choices } = edit.book;
    await changeBook(tx, change, choices);
    await changeWorld(tx, change, world);
  }
}

/** The scene Procreator plays next: the one being played, or the one waiting for the owner to go on. */
async function sceneAhead(db: Db | Tx, bookId: string): Promise<Scene | null> {
  const playing = await playingScene(db, bookId);
  if (playing) {
    return playing;
  }
  return nextScene(db, bookId);
}

/** The scene's session, if it has opened, starts again from a brief built from the story as it stands. */
async function freshBrief(tx: Tx, scene: Scene) {
  const segment = await currentSegment(tx, scene.id);
  if (!segment) {
    return;
  }
  const head = await headFor(tx, scene, '');
  const fromSeq = await nextSeq(tx, scene.id);
  await startSegment(tx, scene, { head, summary: '', fromSeq, turnId: null });
}

/** Tells Procreator of a change that holds from now on: a note at the end of the session of the scene ahead. */
async function tellProcreator(tx: Tx, bookId: string, note: ChangeNoteView) {
  const scene = await sceneAhead(tx, bookId);
  if (!scene || note.changed.length === 0) {
    return;
  }
  // Made at no turn, so an undo of the newest turn leaves it, as it leaves the change.
  const text = render('procreator/change.njk', note);
  await addMessage(tx, scene, 'note', null, { role: 'user', content: text, timestamp: Date.now() });
}

/** The passages Procreator rewrote for a change that reaches back, and the model whose words the restarted sessions hold. */
export interface Rewrite {
  passages: Rewritten[];
  model: Model<Api>;
}

/** What a change that reached back rewrote: the change that keeps the passages (null when none needed it), and how many. */
export interface Rewrote {
  change: number | null;
  count: number;
}

/**
 * The owner changes the story mid play (step 6): a sheet, someone new, someone leaving, a line,
 * two untied, or the book's choices and world. It's tagged as the owner's at the newest turn, so
 * an undo of that turn leaves it standing.
 *
 * - Before anything is played, the session (if the first scene's has opened) starts afresh.
 * - From now on, Procreator is told with a note at the end of the scene's session.
 * - When it reaches back (a rename, or always so), the passages Procreator rewrote are kept as
 *   another change, and every session and actor's chat that will be sent again starts afresh
 *   from the story as it now reads. Answers with what it rewrote.
 */
export async function ownerEdit(db: Db, bookId: string, edit: StoryEdit, reach: Reach, rewrite: Rewrite | null = null): Promise<Rewrote | null> {
  const newest = await newestInBook(db, bookId);
  const played = newest !== null;
  return db.transaction(async (tx) => {
    const before = await readStory(tx, bookId);
    const reaching = reachingOf(before, edit, reach, played);
    if (reaching && !rewrite) {
      throw new Error('A change that reaches back is kept with what Procreator rewrote for it.');
    }
    const note = changeNoteView(before, edit);
    if (note.changed.length === 0) {
      return null;
    }
    let turnId: string | null = null;
    if (newest) {
      turnId = newest.id;
    }
    const what = whatOf(before, edit, played, reaching);
    const change = await startChange(tx, { bookId, turnId, by: 'owner', what, why: whyOf(reach, reaching) });
    const keepsPast = played && !reaching?.always;
    await applyEdit(tx, change, edit, keepsPast);

    if (!played) {
      const scene = await sceneAhead(tx, bookId);
      if (scene) {
        await freshBrief(tx, scene);
      }
      return null;
    }
    if (!reaching || !rewrite) {
      await tellProcreator(tx, bookId, note);
      return null;
    }

    const cast = await castByName(tx, bookId);
    const own = rewrite.passages.filter((each) => each.passage.spot.kind === 'story');
    let rewrote: Rewrote = { change: null, count: 0 };
    if (own.length > 0) {
      const rewriting = await startChange(tx, { bookId, turnId, by: 'owner', what, why: REWROTE });
      for (const each of own) {
        await rewritePassage(tx, rewriting, each.passage, each.text, cast);
      }
      rewrote = { change: rewriting.id, count: own.length };
    }
    await restartCopies(tx, bookId, rewrite.model, copiesOf(rewrite.passages));
    if (!reaching.always) {
      // Beside a rename, the rest of the sheet holds from now on.
      await tellProcreator(tx, bookId, changeNoteView(before, withoutRename(before, edit)));
    }
    return rewrote;
  });
}
