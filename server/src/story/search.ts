import { and, asc, eq, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { Db, Tx } from '../db/client.ts';
import { chapters, scenes, turns } from '../db/schema.ts';
import { castOf, namesOf } from './cast.ts';
import { StoryError } from './changes.ts';
import { linked } from './mentions.ts';
import { pagesOf } from './pages.ts';

/*
 * Recall: exact words in the reference, the scene summaries, every turn that still stands and the
 * book as it's written, for when a summary isn't enough. The words match as given, in any case and however the text breaks
 * its lines. Pages are searched as Procreator reads them, people as [[Name]]. Every match can be
 * reached: a search shows a dozen at a time, and the next dozen are a search away, since a common
 * name could otherwise pour hundreds into the session.
 */

/** How many matches a search shows at once. */
export const SHOWN = 12;

export interface Match {
  /** Where it is: "Aiko's page", "The Keep, a page", "Scene 3, its summary", "Scene 3, turn 41, the reply". */
  where: string;
  /** The paragraph the words are in. */
  text: string;
}

export interface Recall {
  matches: Match[];
  /** The number of the first match shown, counting from 1. */
  from: number;
  /** How many matched in all. */
  total: number;
}

function cleanWords(words: string): string {
  const spaced = words.trim().replace(/\s+/g, ' ');
  if (spaced.length < 2) {
    throw new StoryError('Say what words to look for.');
  }
  return spaced;
}

/** Text on one line, its whitespace run together, as the words are matched against it. */
function flatten(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/**
 * The paragraph the words first come in, on one line, or the whole text when the words run across
 * a paragraph break. Null when the text doesn't hold them.
 */
function excerpt(text: string, words: string): string | null {
  const wanted = words.toLowerCase();
  for (const paragraph of text.split(/\n\s*\n/)) {
    const line = flatten(paragraph);
    if (line.toLowerCase().includes(wanted)) {
      return line;
    }
  }
  const whole = flatten(text);
  if (whole.toLowerCase().includes(wanted)) {
    return whole;
  }
  return null;
}

/** Text in parts, each part a paragraph of its own. */
function inParagraphs(parts: string[]): string {
  const written = parts.filter((part) => part.trim() !== '');
  return written.join('\n\n');
}

/** A column's text holds the words, in any case and however its lines break. */
function holds(column: PgColumn, words: string): SQL {
  const flat = sql`regexp_replace(lower(${column}), ${'\\s+'}, ' ', 'g')`;
  return sql`strpos(${flat}, ${words.toLowerCase()}) > 0`;
}

async function inPages(db: Db | Tx, bookId: string, words: string): Promise<Match[]> {
  const cast = await castOf(db, bookId);
  const names = namesOf(cast);
  const pages = await pagesOf(db, bookId);
  const matches: Match[] = [];
  for (const character of cast) {
    const page = pages.find((each) => each.characterId === character.id);
    const parts = [character.who, character.personality, character.past, character.notes];
    if (page) {
      parts.push(page.about, linked(page.body, names));
    }
    const text = excerpt(inParagraphs(parts), words);
    if (text) {
      matches.push({ where: `${character.name}'s page`, text });
    }
  }
  const others = pages.filter((page) => page.characterId === null);
  others.sort((one, other) => one.title.localeCompare(other.title));
  for (const page of others) {
    const text = excerpt(inParagraphs([page.title, page.about, linked(page.body, names)]), words);
    if (text) {
      matches.push({ where: `${page.title}, a page`, text });
    }
  }
  return matches;
}

async function inSummaries(db: Db | Tx, bookId: string, words: string): Promise<Match[]> {
  const rows = await db
    .select()
    .from(scenes)
    .where(and(eq(scenes.bookId, bookId), holds(scenes.summary, words)))
    .orderBy(asc(scenes.number));
  const matches: Match[] = [];
  for (const scene of rows) {
    const text = excerpt(scene.summary, words);
    if (text) {
      matches.push({ where: `Scene ${scene.number}, its summary`, text });
    }
  }
  return matches;
}

async function inTurns(db: Db | Tx, bookId: string, words: string): Promise<Match[]> {
  const rows = await db
    .select({ turn: turns, scene: scenes.number })
    .from(turns)
    .innerJoin(scenes, eq(scenes.id, turns.sceneId))
    .where(and(eq(turns.bookId, bookId), eq(turns.undone, false), or(holds(turns.input, words), holds(turns.reply, words))))
    .orderBy(asc(turns.number));
  const matches: Match[] = [];
  for (const { turn, scene } of rows) {
    const place = `Scene ${scene}, turn ${turn.number}`;
    const input = excerpt(turn.input, words);
    if (input) {
      let whose = "the owner's move";
      if (turn.voice === 'author') {
        whose = "the owner's author note";
      }
      matches.push({ where: `${place}, ${whose}`, text: input });
    }
    const reply = excerpt(turn.reply, words);
    if (reply) {
      matches.push({ where: `${place}, the reply`, text: reply });
    }
  }
  return matches;
}

async function inChapters(db: Db | Tx, bookId: string, words: string): Promise<Match[]> {
  const rows = await db
    .select()
    .from(chapters)
    .where(and(eq(chapters.bookId, bookId), or(holds(chapters.title, words), holds(chapters.body, words))))
    .orderBy(asc(chapters.number));
  const matches: Match[] = [];
  for (const chapter of rows) {
    const text = excerpt(inParagraphs([chapter.title, chapter.body]), words);
    if (text) {
      matches.push({ where: `Chapter ${chapter.number} of the book`, text });
    }
  }
  return matches;
}

/**
 * Where the words are: pages first, then summaries, turns and the book in story order. Shows a
 * dozen matches, starting from match number `from`.
 */
export async function searchStory(db: Db | Tx, bookId: string, words: string, from = 1): Promise<Recall> {
  const clean = cleanWords(words);
  const found = [
    ...(await inPages(db, bookId, clean)),
    ...(await inSummaries(db, bookId, clean)),
    ...(await inTurns(db, bookId, clean)),
    ...(await inChapters(db, bookId, clean)),
  ];
  const start = from - 1;
  const matches = found.slice(start, start + SHOWN);
  return { matches, from, total: found.length };
}
