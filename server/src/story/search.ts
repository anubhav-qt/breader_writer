import { and, asc, eq, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { Db, Tx } from '../db/client.ts';
import { scenes, turns } from '../db/schema.ts';
import { castOf, namesOf } from './cast.ts';
import { StoryError } from './changes.ts';
import { linked } from './mentions.ts';
import { pagesOf } from './pages.ts';

/*
 * Recall: exact words in the reference, the scene summaries and every turn that still stands, for
 * when a summary isn't enough. The words match as given, in any case and however the text breaks
 * its lines. Pages are searched as Procreator reads them, people as [[Name]].
 */

export const MAX_MATCHES = 12;
/** How much of the text on each side of a match comes with it. */
const AROUND = 120;

export interface Match {
  /** Where it is: "Aiko's page", "The Keep, a page", "Scene 3, its summary", "Scene 3, turn 41, the reply". */
  where: string;
  /** The words, with some of the text around them. */
  text: string;
}

export interface Recall {
  matches: Match[];
  /** How many more matched than are given. */
  more: number;
}

function cleanWords(words: string): string {
  const spaced = words.trim().replace(/\s+/g, ' ');
  if (spaced.length < 2) {
    throw new StoryError('Say what words to look for.');
  }
  return spaced;
}

/** The words where they first come in the text, with some of the text around them, or null. */
function excerpt(text: string, words: string): string | null {
  const flat = text.replace(/\s+/g, ' ');
  const at = flat.toLowerCase().indexOf(words.toLowerCase());
  if (at === -1) {
    return null;
  }
  const start = Math.max(0, at - AROUND);
  const end = Math.min(flat.length, at + words.length + AROUND);
  let piece = flat.slice(start, end);
  if (start > 0) {
    piece = `…${piece}`;
  }
  if (end < flat.length) {
    piece = `${piece}…`;
  }
  return piece;
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
    const text = excerpt(parts.join('\n'), words);
    if (text) {
      matches.push({ where: `${character.name}'s page`, text });
    }
  }
  const others = pages.filter((page) => page.characterId === null);
  others.sort((one, other) => one.title.localeCompare(other.title));
  for (const page of others) {
    const text = excerpt(`${page.title}\n${page.about}\n${linked(page.body, names)}`, words);
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

/** Where the words are: pages first, then summaries and turns in story order. */
export async function searchStory(db: Db | Tx, bookId: string, words: string): Promise<Recall> {
  const clean = cleanWords(words);
  const found = [
    ...(await inPages(db, bookId, clean)),
    ...(await inSummaries(db, bookId, clean)),
    ...(await inTurns(db, bookId, clean)),
  ];
  const matches = found.slice(0, MAX_MATCHES);
  const more = found.length - matches.length;
  return { matches, more };
}
