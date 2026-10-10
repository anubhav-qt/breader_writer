import { and, eq } from 'drizzle-orm';
import type { RewriteView, RewrittenPassage, StoryView } from '@writer/shared/story';
import { REWROTE } from '../breading_ground.ts';
import type { Db } from '../db/client.ts';
import { changes } from '../db/schema.ts';
import { castOf, namesOf } from '../story/cast.ts';
import { versionsOf, type Version } from '../story/changes.ts';
import { named } from '../story/mentions.ts';
import { pagesOf } from '../story/pages.ts';
import { spotKey, wheresOf } from '../story/passages.ts';
import { readStory } from '../story/read.ts';
import { newestInBook } from '../story/scenes.ts';
import { readSetup, type BookRow } from './setup.ts';

/*
 * The story as the Story panel shows it mid play (step 6): the book's choices, the world, the cast
 * as it stands and the lines between them (setup's own pieces), with Procreator's page about each
 * person, and whether anything has been played yet. And what a change that reached back rewrote,
 * each passage before and after, for the quiet line it leaves in the play's page.
 */

export async function storyView(db: Db, book: BookRow): Promise<StoryView> {
  const setup = await readSetup(db, book);
  const names = namesOf(await castOf(db, book.id));
  const pages: Record<string, string> = {};
  for (const page of await pagesOf(db, book.id)) {
    if (page.characterId !== null) {
      pages[page.characterId] = named(page.body, names);
    }
  }
  const newest = await newestInBook(db, book.id);
  return { setup, pages, played: newest !== null };
}

/** Where a passage no longer in the story was, by its table. */
const ONCE_IN: Record<string, string> = {
  turns: 'A turn taken back since',
  notes: 'Procreator’s memory',
  relationship_history: 'A relationship’s history',
  pages: 'A page',
};

/** One passage a rewrite changed: a column it edited, or a note or history entry it emptied, which went. */
function passageOf(version: Version, wheres: Map<string, string>, names: Map<string, string>): RewrittenPassage {
  const before = (version.before ?? {}) as Record<string, unknown>;
  const after = version.after as Record<string, unknown> | null;
  let column = 'text';
  if (after) {
    column = Object.keys(after)[0];
  }
  const key = version.key as Record<string, unknown>;
  const where = wheres.get(spotKey(version.table, key, column)) ?? ONCE_IN[version.table] ?? 'The story';
  let afterText = '';
  if (after) {
    afterText = String(after[column] ?? '');
  }
  return {
    where,
    before: named(String(before[column] ?? ''), names),
    after: named(afterText, names),
  };
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
