import type { StoryView } from '@writer/shared/story';
import type { Db } from '../db/client.ts';
import { castOf, namesOf } from '../story/cast.ts';
import { named } from '../story/mentions.ts';
import { pagesOf } from '../story/pages.ts';
import { newestInBook } from '../story/scenes.ts';
import { readSetup, type BookRow } from './setup.ts';

/*
 * The story as the Story panel shows it mid play (step 6): the book's choices, the world, the cast
 * as it stands and the lines between them (setup's own pieces), with Procreator's page about each
 * person, and whether anything has been played yet.
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
