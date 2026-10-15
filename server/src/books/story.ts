import { and, eq } from 'drizzle-orm';
import type { MemoryNote, PageKind, ReferencePage, RewriteView, RewrittenPassage, StoryView } from '@writer/shared/story';
import { REWROTE } from '../breading_ground.ts';
import type { Db } from '../db/client.ts';
import { changes } from '../db/schema.ts';
import { castOf, namesOf } from '../story/cast.ts';
import { versionsOf, type Version } from '../story/changes.ts';
import { notesOf } from '../story/memory.ts';
import { linked, named } from '../story/mentions.ts';
import { pagesOf, type Page } from '../story/pages.ts';
import { OPENINGS_WHERE, spotKey, wheresOf } from '../story/passages.ts';
import { readStory } from '../story/read.ts';
import { newestInBook } from '../story/scenes.ts';
import { indexOf } from '../story/view.ts';
import { readSetup, type BookRow } from './setup.ts';

/*
 * The story as the Story panel shows it mid play (step 6): the book's choices, the world, the cast
 * as it stands and the lines between them (setup's own pieces), with Procreator's page about each
 * person, and whether anything has been played yet. And what a change that reached back rewrote,
 * each passage before and after, for the quiet line it leaves in the play's page.
 */

/** A page as the Notes panel reads and edits it: people in the cast as links, and a character's under their name. */
function referencePage(page: Page, names: Map<string, string>): ReferencePage {
  let title = page.title;
  if (page.characterId !== null) {
    title = names.get(page.characterId) ?? '';
  }
  return {
    id: page.id,
    kind: page.kind as PageKind,
    characterId: page.characterId,
    title,
    about: page.about,
    body: linked(page.body, names),
  };
}

export async function storyView(db: Db, book: BookRow): Promise<StoryView> {
  const setup = await readSetup(db, book);
  const names = namesOf(await castOf(db, book.id));
  const all = await pagesOf(db, book.id);
  const pages: Record<string, string> = {};
  const reference: ReferencePage[] = [];
  for (const page of all) {
    if (page.characterId !== null) {
      pages[page.characterId] = named(page.body, names);
      reference.push(referencePage(page, names));
    }
  }
  // Every other page by kind, then title, as Procreator's index has them.
  for (const entry of indexOf(all)) {
    const page = all.find((each) => each.characterId === null && each.title === entry.title);
    if (page) {
      reference.push(referencePage(page, names));
    }
  }
  const memory: MemoryNote[] = [];
  for (const note of await notesOf(db, book.id)) {
    memory.push({ id: note.id, text: linked(note.text, names) });
  }
  const newest = await newestInBook(db, book.id);
  return { setup, pages, reference, memory, played: newest !== null };
}

/** Where a passage no longer in the story was, by its table. */
const ONCE_IN: Record<string, string> = {
  turns: 'A turn taken back since',
  notes: 'Procreator’s memory',
  relationship_history: 'A relationship’s history',
  pages: 'A page',
};

/** The openings offered, as one passage: each on its own lines, its words, then where and when. */
function openingsText(value: unknown): string {
  if (!Array.isArray(value)) {
    return '';
  }
  const parts: string[] = [];
  for (const offer of value as { text: string; place: string; time: string }[]) {
    const given = [offer.place, offer.time].filter((part) => part !== '');
    const setting = given.join(', ');
    if (setting) {
      parts.push(`${offer.text}\n(${setting})`);
    } else {
      parts.push(offer.text);
    }
  }
  return parts.join('\n\n');
}

/** A column's text as the owner reads it, whatever the column keeps: openings and a cue are kept whole. */
function textOf(column: string, value: unknown, names: Map<string, string>): string {
  if (column === 'openings') {
    return openingsText(value);
  }
  if (column === 'cue') {
    const cue = value as { sees?: string } | null;
    return cue?.sees ?? '';
  }
  return named(String(value ?? ''), names);
}

/** One passage a rewrite changed: a column it edited, or a note or history entry it emptied, which went. */
function passageOf(version: Version, wheres: Map<string, string>, names: Map<string, string>): RewrittenPassage {
  const before = (version.before ?? {}) as Record<string, unknown>;
  const after = version.after as Record<string, unknown> | null;
  let column = 'text';
  if (after) {
    column = Object.keys(after)[0];
  }
  const key = version.key as Record<string, unknown>;
  let where = wheres.get(spotKey(version.table, key, column)) ?? ONCE_IN[version.table] ?? 'The story';
  if (column === 'openings') {
    where = OPENINGS_WHERE;
  }
  let afterText = '';
  if (after) {
    afterText = textOf(column, after[column], names);
  }
  return { where, before: textOf(column, before[column], names), after: afterText };
}

/** What a change that reached back rewrote, passage by passage, or null when it isn't one of the book's. */
export async function rewriteView(db: Db, bookId: string, changeId: number): Promise<RewriteView | null> {
  const [change] = await db
    .select()
    .from(changes)
    .where(and(eq(changes.id, changeId), eq(changes.bookId, bookId), eq(changes.why, REWROTE)));
  if (!change) {
    return null;
  }
  const story = await readStory(db, bookId);
  const wheres = await wheresOf(db, story);
  const names = namesOf(story.characters);
  const passages: RewrittenPassage[] = [];
  for (const version of await versionsOf(db, change.id)) {
    passages.push(passageOf(version, wheres, names));
  }
  return { what: change.what, passages };
}
