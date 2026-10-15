import { and, eq, isNull, sql } from 'drizzle-orm';
import { PageKind as Kinds, PLAN, THREADS, TIMELINE } from '@writer/shared/story';
import type { Db, Tx } from '../db/client.ts';
import { pages } from '../db/schema.ts';
import { castOf, namesOf, type CharacterRow } from './cast.ts';
import { edit, make, startChange, StoryError, type Writer } from './changes.ts';
import { Cast, linked, unlinked } from './mentions.ts';

/*
 * The reference: the story's canon in depth, a page for each subject, which Procreator writes as
 * the story establishes things and reads when it needs them. A character's page goes by their
 * name: the owner's sheet on top (on characters, which only the owner changes) and Procreator's
 * own depth below it (a page here, with the character's id). In a page, people are kept as <@id>
 * and shown to Procreator as [[Name]].
 *
 * A write is part of a change (story/changes.ts), so it's tagged, versioned and can be taken back.
 * It starts its change only when it changes something, so a write of what the page already says
 * leaves no trace, and a retry never doubles anything.
 */

export const PAGE_KINDS = Kinds.options;
export type PageKind = (typeof PAGE_KINDS)[number];

/** The story's own pages. Every brief holds the Plan and the Threads; the Timeline is read when needed. */
export { PLAN, THREADS, TIMELINE };

export type Page = typeof pages.$inferSelect;

/** A page written whole. */
export interface PageWrite {
  title: string;
  kind: PageKind;
  /** One line for the index. A character's page can do without it: the cast says who they are. */
  about: string;
  body: string;
}

/** Part of a page changed: `find`, on the page exactly once, becomes `replace`. An empty `find` adds `replace` at the end. */
export interface PageEdit {
  title: string;
  find: string;
  replace: string;
}

/** What a write did: made the page, changed it, or found it already said so. */
export type Outcome = 'made' | 'changed' | 'unchanged';

export interface Written {
  page: Page;
  outcome: Outcome;
}

/** What a title names: someone in the cast (with Procreator's page on them, once it has one), or a page. */
export interface Found {
  character: CharacterRow | null;
  page: Page | null;
}

export function isKind(kind: string): kind is PageKind {
  const kinds: readonly string[] = PAGE_KINDS;
  return kinds.includes(kind);
}

/** A title as it's kept: trimmed, with single spaces. */
export function cleanTitle(title: string): string {
  const spaced = title.trim().replace(/\s+/g, ' ');
  if (!spaced) {
    throw new StoryError('The page needs a title.');
  }
  if (/[[\]]/.test(spaced)) {
    throw new StoryError('Write the title without brackets. A link, [[Name]], is for naming someone inside a page.');
  }
  return spaced;
}

export function cleanAbout(about: string, required: boolean): string {
  const line = about.trim().replace(/\s+/g, ' ');
  if (!line && required) {
    throw new StoryError('Say in one line what the page holds, for the index.');
  }
  return line;
}

/** A page's text as it's kept, from the way Procreator writes it. */
function cleanBody(body: string, cast: CharacterRow[]): string {
  const trimmed = body.trim();
  if (!trimmed) {
    throw new StoryError('The page is empty. Write what it holds.');
  }
  return unlinked(trimmed, new Cast(cast));
}

/** Who or what a title names. Someone in the cast comes first: no other page can take their name. */
async function find(db: Db | Tx, bookId: string, cast: CharacterRow[], title: string): Promise<Found> {
  const clean = cleanTitle(title);
  const ids = new Cast(cast).idsOf(clean);
  if (ids.length > 1) {
    throw new StoryError(`More than one person in the cast is called ${clean}, so their pages can't be told apart by name.`);
  }
  if (ids.length === 1) {
    const character = cast.find((person) => person.id === ids[0]) as CharacterRow;
    const [page] = await db.select().from(pages).where(and(eq(pages.bookId, bookId), eq(pages.characterId, character.id)));
    return { character, page: page ?? null };
  }
  const [page] = await db
    .select()
    .from(pages)
    .where(and(eq(pages.bookId, bookId), isNull(pages.characterId), sql`lower(${pages.title}) = ${clean.toLowerCase()}`));
  return { character: null, page: page ?? null };
}

/** Who or what a title names, with the cast it was looked up in. */
export async function findPage(db: Db | Tx, bookId: string, title: string): Promise<Found & { cast: CharacterRow[] }> {
  const cast = await castOf(db, bookId);
  const found = await find(db, bookId, cast, title);
  return { ...found, cast };
}

/** Every page of a book's reference, characters' included. */
export async function pagesOf(db: Db | Tx, bookId: string): Promise<Page[]> {
  return db.select().from(pages).where(eq(pages.bookId, bookId));
}

/** Changes the columns that differ, as one change, or nothing when none do. */
async function rewrite(tx: Tx, writer: Writer, page: Page, next: Partial<Page>, what: string): Promise<Written> {
  const set: Partial<Page> = {};
  if (next.kind !== undefined && next.kind !== page.kind) {
    set.kind = next.kind;
  }
  if (next.about !== undefined && next.about !== page.about) {
    set.about = next.about;
  }
  if (next.body !== undefined && next.body !== page.body) {
    set.body = next.body;
  }
  if (Object.keys(set).length === 0) {
    return { page, outcome: 'unchanged' };
  }
  const change = await startChange(tx, { ...writer, what });
  const changed = await edit(tx, change, pages, { id: page.id }, set);
  return { page: changed, outcome: 'changed' };
}

async function makeCharacterPage(tx: Tx, writer: Writer, character: CharacterRow, about: string, body: string): Promise<Written> {
  const change = await startChange(tx, { ...writer, what: `Wrote ${character.name}'s page` });
  const page = await make(tx, change, pages, { bookId: writer.bookId, kind: 'character', characterId: character.id, about, body });
  return { page, outcome: 'made' };
}

async function writeCharacterPage(tx: Tx, writer: Writer, found: Found, write: PageWrite, body: string): Promise<Written> {
  const character = found.character as CharacterRow;
  if (write.kind !== 'character') {
    throw new StoryError(
      `${character.name} is in the cast, so the page called ${character.name} is theirs: write it with kind character, or give this page another title.`,
    );
  }
  const about = cleanAbout(write.about, false);
  if (!found.page) {
    return makeCharacterPage(tx, writer, character, about, body);
  }
  return rewrite(tx, writer, found.page, { about, body }, `Rewrote ${character.name}'s page`);
}

async function writeOtherPage(tx: Tx, writer: Writer, found: Found, title: string, write: PageWrite, body: string): Promise<Written> {
  if (write.kind === 'character') {
    throw new StoryError(
      `No one in the cast is called ${title}. A character page is for someone in the cast: write about anyone else on the page they belong to, or with another kind.`,
    );
  }
  if (!isKind(write.kind)) {
    throw new StoryError(`A page's kind is one of ${PAGE_KINDS.join(', ')}.`);
  }
  const about = cleanAbout(write.about, true);
  if (!found.page) {
    const change = await startChange(tx, { ...writer, what: `Wrote the page ${title}` });
    const page = await make(tx, change, pages, { bookId: writer.bookId, kind: write.kind, title, about, body });
    return { page, outcome: 'made' };
  }
  return rewrite(tx, writer, found.page, { kind: write.kind, about, body }, `Rewrote the page ${found.page.title}`);
}

/** Makes a page, or replaces all of one (the change log keeps the old). */
export async function writePage(tx: Tx, writer: Writer, write: PageWrite): Promise<Written> {
  const title = cleanTitle(write.title);
  const cast = await castOf(tx, writer.bookId);
  const body = cleanBody(write.body, cast);
  const found = await find(tx, writer.bookId, cast, title);
  if (found.character) {
    return writeCharacterPage(tx, writer, found, write, body);
  }
  return writeOtherPage(tx, writer, found, title, write, body);
}

/** What part of the page an edit can reach, for saying so when the text isn't there. */
function notFound(found: Found): StoryError {
  if (found.character) {
    return new StoryError(
      `That text isn't in your part of ${found.character.name}'s page (the sheet above it is the owner's, and only they change it). Read the page again and copy the text exactly.`,
    );
  }
  return new StoryError('That text isn\'t on the page. Read it again and copy the text exactly, or leave find empty to add to the end.');
}

/** The page's text with the edit made, as Procreator reads it. */
function edited(shown: string, change: PageEdit, found: Found): string {
  if (change.find === '') {
    const addition = change.replace.trim();
    if (!addition) {
      throw new StoryError('There is nothing to add. Put the new text in replace.');
    }
    // Added already, by this same edit sent twice.
    if (shown.trimEnd().endsWith(addition)) {
      return shown;
    }
    return `${shown.trimEnd()}\n\n${addition}`;
  }
  const at = shown.indexOf(change.find);
  if (at === -1) {
    throw notFound(found);
  }
  const again = shown.indexOf(change.find, at + 1);
  if (again !== -1) {
    throw new StoryError('That text is on the page more than once. Take in more of the text around it, so it\'s there once.');
  }
  const before = shown.slice(0, at);
  const after = shown.slice(at + change.find.length);
  return before + change.replace + after;
}

/** Changes part of a page, or adds to its end. Adding to a character's page that has nothing yet makes it. */
export async function editPage(tx: Tx, writer: Writer, change: PageEdit): Promise<Written> {
  const cast = await castOf(tx, writer.bookId);
  const found = await find(tx, writer.bookId, cast, change.title);
  if (found.character && !found.page) {
    if (change.find !== '') {
      throw new StoryError(`${found.character.name}'s page has nothing of yours yet. Add to it with find left empty, or write it with write_page.`);
    }
    const body = cleanBody(change.replace, cast);
    return makeCharacterPage(tx, writer, found.character, '', body);
  }
  if (!found.page) {
    throw new StoryError(`There's no page called ${change.title}. Your brief's index lists every page; write_page makes a new one.`);
  }
  const shown = linked(found.page.body, namesOf(cast));
  const body = cleanBody(edited(shown, change, found), cast);
  let what = `Changed the page ${found.page.title}`;
  if (found.character) {
    what = `Changed ${found.character.name}'s page`;
  }
  return rewrite(tx, writer, found.page, { body }, what);
}
