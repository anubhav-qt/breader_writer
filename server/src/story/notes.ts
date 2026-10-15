import { and, eq, isNull } from 'drizzle-orm';
import type { PageDraft } from '@writer/shared/story';
import type { Tx } from '../db/client.ts';
import { notes, pages } from '../db/schema.ts';
import { castOf, type CharacterRow } from './cast.ts';
import { edit, make, remove, StoryError, type Change } from './changes.ts';
import { Cast, unlinked } from './mentions.ts';
import { cleanAbout, cleanTitle, isKind, PLAN, THREADS, TIMELINE, type Page } from './pages.ts';
import type { Note } from './memory.ts';

/*
 * What the owner changes from the Notes panel (step 6): the reference's pages and Procreator's
 * memory. Procreator writes both as it plays (story/pages.ts, story/memory.ts); the owner reads
 * and edits them, and the owner's edit wins. Each is part of a change (story/changes.ts), so it's
 * tagged as the owner's and keeps the version it replaced. People in the cast are written as links,
 * [[Name]], and kept as mentions, as Procreator's own writes are. Only breading_ground calls these.
 */

/** The story's own pages, which keep their titles: Procreator and its brief look for them by name. */
const OWN_TITLES = [PLAN, THREADS, TIMELINE].map((title) => title.toLowerCase());

/** A page of the book's by id, or a StoryError. */
async function pageById(tx: Tx, bookId: string, id: string): Promise<Page> {
  const [page] = await tx
    .select()
    .from(pages)
    .where(and(eq(pages.bookId, bookId), eq(pages.id, id)));
  if (!page) {
    throw new StoryError('That page isn’t in the reference any more.');
  }
  return page;
}

/** A title the owner gave a page, as it's kept: not a cast member's name, and no other page's. */
async function ownTitle(tx: Tx, bookId: string, cast: CharacterRow[], title: string, self: Page | null): Promise<string> {
  const clean = cleanTitle(title);
  if (new Cast(cast).idsOf(clean).length > 0) {
    throw new StoryError(`${clean} is someone in the cast, and their page is in their sheet. Give this page another title.`);
  }
  const others = await tx
    .select()
    .from(pages)
    .where(and(eq(pages.bookId, bookId), isNull(pages.characterId)));
  const taken = others.find((page) => page.id !== self?.id && page.title.toLowerCase() === clean.toLowerCase());
  if (taken) {
    throw new StoryError(`There’s a page called ${taken.title} already.`);
  }
  const was = self?.title.toLowerCase() ?? '';
  if (self && OWN_TITLES.includes(was) && clean.toLowerCase() !== was) {
    throw new StoryError(`${self.title} keeps its title: Procreator looks for it by name.`);
  }
  return clean;
}

/** The columns that differ, set on the page as one edit, or nothing when none do. */
async function setPage(tx: Tx, change: Change, page: Page, next: Partial<Page>) {
  const set: Partial<Page> = {};
  for (const [column, value] of Object.entries(next)) {
    if (page[column as keyof Page] !== value) {
      set[column as keyof Page] = value as never;
    }
  }
  if (Object.keys(set).length === 0) {
    return;
  }
  await edit(tx, change, pages, { id: page.id }, set);
}

/** A character's page as the owner wrote it: made the first time, else changed. */
async function saveCharacterPage(tx: Tx, change: Change, cast: CharacterRow[], draft: PageDraft, body: string) {
  const person = cast.find((each) => each.id === draft.characterId);
  if (!person) {
    throw new StoryError('That person isn’t in the story.');
  }
  const about = cleanAbout(draft.about, false);
  const [page] = await tx
    .select()
    .from(pages)
    .where(and(eq(pages.bookId, change.bookId), eq(pages.characterId, person.id)));
  if (!page) {
    await make(tx, change, pages, { bookId: change.bookId, kind: 'character', characterId: person.id, about, body });
    return;
  }
  await setPage(tx, change, page, { about, body });
}

/** A page of the reference as the owner wrote it: a new one, or one changed. A character's goes by its person. */
export async function savePage(tx: Tx, change: Change, draft: PageDraft) {
  const cast = await castOf(tx, change.bookId);
  const body = unlinked(draft.body.trim(), new Cast(cast));
  if (draft.characterId !== null) {
    await saveCharacterPage(tx, change, cast, draft, body);
    return;
  }
  if (draft.kind === 'character' || !isKind(draft.kind)) {
    throw new StoryError('A character’s page goes by the person it’s about. Pick another kind for this one.');
  }
  const about = cleanAbout(draft.about, true);
  if (draft.id === null) {
    const title = await ownTitle(tx, change.bookId, cast, draft.title, null);
    await make(tx, change, pages, { bookId: change.bookId, kind: draft.kind, title, about, body });
    return;
  }
  const page = await pageById(tx, change.bookId, draft.id);
  if (page.characterId !== null) {
    throw new StoryError('That page is someone’s, and goes by their name.');
  }
  const title = await ownTitle(tx, change.bookId, cast, draft.title, page);
  await setPage(tx, change, page, { kind: draft.kind, title, about, body });
}

/** A page taken out of the reference. */
export async function removePage(tx: Tx, change: Change, id: string): Promise<Page> {
  const page = await pageById(tx, change.bookId, id);
  await remove(tx, change, pages, { id: page.id });
  return page;
}

/** A note of Procreator's memory as the owner wrote it: one line, people as links. */
async function noteText(tx: Tx, bookId: string, text: string): Promise<string> {
  const line = text.trim().replace(/\s+/g, ' ');
  if (!line) {
    throw new StoryError('The note is empty.');
  }
  const cast = await castOf(tx, bookId);
  return unlinked(line, new Cast(cast));
}

/** A note of the book's by id, or a StoryError. */
async function noteById(tx: Tx, bookId: string, id: number): Promise<Note> {
  const [note] = await tx
    .select()
    .from(notes)
    .where(and(eq(notes.bookId, bookId), eq(notes.id, id)));
  if (!note) {
    throw new StoryError('That note isn’t in Procreator’s memory any more.');
  }
  return note;
}

/** A note of Procreator's memory as the owner wrote it: a new one (no id), or one changed. */
export async function saveNote(tx: Tx, change: Change, id: number | null, text: string) {
  const kept = await noteText(tx, change.bookId, text);
  if (id === null) {
    await make(tx, change, notes, { bookId: change.bookId, text: kept });
    return;
  }
  const note = await noteById(tx, change.bookId, id);
  if (note.text === kept) {
    return;
  }
  await edit(tx, change, notes, { id }, { text: kept });
}

/** A note taken out of Procreator's memory. */
export async function dropNote(tx: Tx, change: Change, id: number): Promise<Note> {
  const note = await noteById(tx, change.bookId, id);
  await remove(tx, change, notes, { id });
  return note;
}
