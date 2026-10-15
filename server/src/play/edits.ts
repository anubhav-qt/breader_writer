import { pairKey, WORD_GOALS, type Darkness, type Length, type Pov } from '@writer/shared/book';
import type { Reach, StoryEdit } from '@writer/shared/story';
import { ownerEdit, reachingOf, type Reaching, type Rewrote } from '../breading_ground.ts';
import type { Db } from '../db/client.ts';
import { rewritePast, type RewriteBrief } from '../procreator/rewrite.ts';
import type { Procreator } from '../procreator/run.ts';
import { StoryError } from '../story/changes.ts';
import { changeNoteView, pageBefore } from '../story/edits.ts';
import { Cast } from '../story/mentions.ts';
import { passagesOf, type PassageGroup, type Untouched } from '../story/passages.ts';
import { readStory, type Story } from '../story/read.ts';
import { newestInBook } from '../story/scenes.ts';
import { settingsView } from '../story/view.ts';

/*
 * The owner's changes mid story, as the Story panel makes them (step 6). A change that holds from
 * now on goes straight to breading_ground. One that reaches back into what was played (a rename,
 * or always so) has Procreator rewrite the story's passages first, a part at a time, and then
 * breading_ground keeps the change and the rewrite together, at once (the owner's pick,
 * 2026-10-11: kept at once, listed after).
 */

async function reachingNow(db: Db, bookId: string, edit: StoryEdit, reach: Reach): Promise<{ story: Story; reaching: Reaching | null }> {
  const played = (await newestInBook(db, bookId)) !== null;
  const story = await readStory(db, bookId);
  return { story, reaching: reachingOf(story, edit, reach, played) };
}

/** Whether the change reaches back into what was played, so Procreator has to rewrite it. */
export async function reachesBack(db: Db, bookId: string, edit: StoryEdit, reach: Reach): Promise<boolean> {
  const { reaching } = await reachingNow(db, bookId, edit, reach);
  return reaching !== null;
}

/** Everyone's name once the change is made: a rename in place, someone written out gone. */
function namesAfter(story: Story, edit: StoryEdit, reaching: Reaching): Map<string, string> {
  const names = new Map<string, string>();
  for (const person of story.characters) {
    names.set(person.id, person.name);
  }
  if (reaching.rename) {
    names.set(reaching.rename.id, reaching.rename.now);
  }
  if (edit.kind === 'leave' && reaching.always) {
    names.delete(edit.id);
  }
  return names;
}

/** What the change makes or takes out itself, so Procreator isn't given it to rewrite. */
function untouchedBy(story: Story, edit: StoryEdit, reaching: Reaching): Untouched {
  const untouched: Untouched = { sheets: [], lines: [], world: false, removed: null, pages: [] };
  if (edit.kind === 'page') {
    const before = pageBefore(story, edit.page);
    if (before) {
      untouched.pages.push(before.id);
    }
  } else if (edit.kind === 'unpage') {
    untouched.pages.push(edit.id);
  } else if (edit.kind === 'sheet') {
    untouched.sheets.push(edit.character.id);
  } else if (edit.kind === 'leave' && reaching.always) {
    untouched.removed = edit.id;
  } else if (edit.kind === 'line') {
    untouched.lines.push(pairKey(edit.relationship.a.id, edit.relationship.b.id));
  } else if (edit.kind === 'untie') {
    untouched.lines.push(pairKey(edit.a, edit.b));
  } else if (edit.kind === 'book') {
    untouched.world = true;
  }
  return untouched;
}

/** The change as Procreator is told it: all of it when it holds always, else the rename alone. */
function briefFor(story: Story, edit: StoryEdit, reaching: Reaching, names: Map<string, string>): RewriteBrief {
  const book = story.book;
  let settings = settingsView(book.length as Length, book.wordGoal, book.pov as Pov, book.darkness as Darkness);
  let title = book.title;
  let pov: RewriteBrief['pov'] = null;
  if (edit.kind === 'book') {
    const choices = edit.book;
    const now = settingsView(choices.length, WORD_GOALS[choices.length], choices.pov, choices.darkness);
    if (reaching.always && choices.pov !== book.pov) {
      pov = { was: settings.pov, now: now.pov };
    }
    settings = now;
    title = choices.title;
  }

  let changed = changeNoteView(story, edit).changed;
  const rename = reaching.rename;
  if (!reaching.always && rename) {
    changed = [{ subject: `${rename.was}’s name`, fields: [{ name: 'Name', was: rename.was, now: rename.now }] }];
  }
  const writtenOut: string[] = [];
  if (edit.kind === 'leave' && reaching.always) {
    const person = story.characters.find((each) => each.id === edit.id);
    writtenOut.push(person?.name ?? 'someone');
  }
  const renames: RewriteBrief['renames'] = [];
  if (rename) {
    renames.push({ was: rename.was, now: rename.now });
  }
  return { book: { title, ...settings }, cast: [...names.values()], changed, renames, writtenOut, pov, always: reaching.always };
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The passages that may name someone by their old name, in any form: a word that starts like one
 * of the name's words, in any case. A rename alone needs Procreator only for those.
 */
export function mayName(groups: PassageGroup[], name: string): PassageGroup[] {
  const words = name.split(/\s+/).filter((word) => word.length > 0);
  const patterns = words.map((word) => new RegExp(`(?<![\\p{L}\\p{N}_])${escaped(word)}`, 'iu'));
  const kept: PassageGroup[] = [];
  for (const group of groups) {
    const passages = group.passages.filter((passage) => patterns.some((pattern) => pattern.test(passage.text)));
    if (passages.length > 0) {
      kept.push({ scene: group.scene, passages });
    }
  }
  return kept;
}

/**
 * Makes the owner's change. One that reaches back has Procreator rewrite the story's passages
 * first, telling onProgress as each part is done, and nothing is kept until it all is. Answers with
 * what was rewritten, or null for a change that didn't reach back.
 */
export async function changeStory(
  db: Db,
  ai: Procreator | null,
  bookId: string,
  edit: StoryEdit,
  reach: Reach,
  onProgress: (done: number, of: number) => void,
): Promise<Rewrote | null> {
  const { story, reaching } = await reachingNow(db, bookId, edit, reach);
  if (!reaching) {
    return ownerEdit(db, bookId, edit, reach);
  }
  if (!ai) {
    // It didn't reach back when it was asked for, so the story changed on the way.
    throw new StoryError('The story changed while this was on its way. Try it again.');
  }
  const names = namesAfter(story, edit, reaching);
  let groups = await passagesOf(db, story, names, untouchedBy(story, edit, reaching));
  if (!reaching.always && reaching.rename) {
    groups = mayName(groups, reaching.rename.was);
  }
  const people: { id: string; name: string }[] = [];
  for (const [id, name] of names) {
    people.push({ id, name });
  }
  const brief = briefFor(story, edit, reaching, names);
  const passages = await rewritePast(ai, bookId, brief, groups, new Cast(people), onProgress);
  return ownerEdit(db, bookId, edit, reach, { passages, model: ai.inUse.model });
}
