import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm';
import type { Mark, Opening, Person, Play, PlayTurn, SceneHead, Stage } from '@writer/shared/play';
import { REWROTE, type Offer } from '../breading_ground.ts';
import type { Db } from '../db/client.ts';
import { books, changes, scenes, versions } from '../db/schema.ts';
import { castOf, namesOf } from '../story/cast.ts';
import { GONE, named } from '../story/mentions.ts';
import { cueOf, turnsOf, type Scene, type Turn, type Voice } from '../story/scenes.ts';

/*
 * The play as the page shows it (shared/src/play.ts): where it stands, the scene on the page with
 * its heading and its turns, and after a turn, a quiet line for whoever joined the cast at it and
 * each relationship that shifted, read from what Procreator changed at the turn.
 */

export function headOf(scene: Scene): SceneHead {
  return { number: scene.number, place: scene.place, time: scene.time };
}

/** The openings offered for the first scene, as the owner reads them. */
function openingsOf(scene: Scene): Opening[] | null {
  if (!scene.openings) {
    return null;
  }
  const offers = scene.openings as Offer[];
  return offers.map((offer) => ({ text: offer.text, place: offer.place, time: offer.time }));
}

function nameOf(names: Map<string, string>, id: string): string {
  return names.get(id) ?? GONE;
}

/** The cast as the quiet lines need it: each person's name, and their place in the cast. */
interface CastIndex {
  names: Map<string, string>;
  places: Map<string, number>;
}

/** Two people in cast order, the one the owner plays first, as a relationship's sheet has them. */
function inCastOrder(cast: CastIndex, a: string, b: string): [string, string] {
  const placeOfA = cast.places.get(a) ?? Infinity;
  const placeOfB = cast.places.get(b) ?? Infinity;
  if (placeOfB < placeOfA) {
    return [b, a];
  }
  return [a, b];
}

/** A row Procreator made at a turn, as a quiet line: someone joining the cast, or a relationship shifting. */
function markOf(table: string, after: unknown, cast: CastIndex): Mark | null {
  if (table === 'characters') {
    const person = after as { id: string; name: string };
    return { kind: 'joined', id: person.id, name: cast.names.get(person.id) ?? person.name };
  }
  if (table === 'relationship_history') {
    const entry = after as { aId: string; bId: string; text: string };
    const [first, second] = inCastOrder(cast, entry.aId, entry.bId);
    const between = `${nameOf(cast.names, first)} and ${nameOf(cast.names, second)}`;
    return { kind: 'shifted', a: first, b: second, between, text: named(entry.text, cast.names) };
  }
  return null;
}

/** The quiet lines after each turn, by turn: what Procreator made at it that still stands. */
async function marksOf(db: Db, turns: Turn[], cast: CastIndex): Promise<Map<string, Mark[]>> {
  const marks = new Map<string, Mark[]>();
  if (turns.length === 0) {
    return marks;
  }
  const rows = await db
    .select({ turnId: changes.turnId, table: versions.table, after: versions.after })
    .from(versions)
    .innerJoin(changes, eq(changes.id, versions.changeId))
    .where(
      and(
        inArray(
          changes.turnId,
          turns.map((turn) => turn.id),
        ),
        eq(changes.by, 'agent'),
        isNull(changes.takenBackBy),
        isNull(versions.before),
        inArray(versions.table, ['characters', 'relationship_history']),
      ),
    )
    .orderBy(asc(versions.id));
  for (const row of rows) {
    const mark = markOf(row.table, row.after, cast);
    if (!mark || !row.turnId) {
      continue;
    }
    const list = marks.get(row.turnId) ?? [];
    list.push(mark);
    marks.set(row.turnId, list);
  }
  for (const rewrite of await rewritesAt(db, turns)) {
    if (!rewrite.turnId) {
      continue;
    }
    const list = marks.get(rewrite.turnId) ?? [];
    list.push({ kind: 'rewrote', change: rewrite.change, what: rewrite.what, count: rewrite.count });
    marks.set(rewrite.turnId, list);
  }
  return marks;
}

/** The owner's changes that reached back at these turns and still stand, with how many passages each rewrote. */
async function rewritesAt(db: Db, turns: Turn[]) {
  return db
    .select({ turnId: changes.turnId, change: changes.id, what: changes.what, count: count(versions.id) })
    .from(changes)
    .innerJoin(versions, eq(versions.changeId, changes.id))
    .where(
      and(
        inArray(
          changes.turnId,
          turns.map((turn) => turn.id),
        ),
        eq(changes.by, 'owner'),
        eq(changes.why, REWROTE),
        isNull(changes.takenBackBy),
      ),
    )
    .groupBy(changes.id)
    .orderBy(asc(changes.id));
}

async function turnsShown(db: Db, scene: Scene | null, cast: CastIndex): Promise<PlayTurn[]> {
  if (!scene) {
    return [];
  }
  const names = cast.names;
  const turns = await turnsOf(db, scene.id);
  const marks = await marksOf(db, turns, cast);
  return turns.map((turn) => {
    let played: Person | null = null;
    if (turn.played !== null) {
      played = { id: turn.played, name: nameOf(names, turn.played) };
    }
    return {
      id: turn.id,
      number: turn.number,
      voice: turn.voice as Voice,
      played,
      input: turn.input,
      reply: turn.reply,
      marks: marks.get(turn.id) ?? [],
    };
  });
}

/** Where the play stands, and which scene is on the page. */
interface Standing {
  stage: Stage;
  onPage: Scene | null;
  next: Scene | null;
  /** Who is about to act, by id, while the owner says who plays them. */
  cue: string | null;
}

/**
 * A scene being played: playing once it has a turn (or waiting for the owner to say who plays
 * someone, when its newest turn stopped at a cue), else waiting for its opening (the first, for
 * the owner's pick).
 */
async function standingOfPlaying(db: Db, playing: Scene): Promise<Standing> {
  const turns = await turnsOf(db, playing.id);
  const newest = turns.at(-1);
  if (newest) {
    const cue = cueOf(newest);
    if (cue) {
      return { stage: 'cue', onPage: playing, next: null, cue: cue.who };
    }
    return { stage: 'playing', onPage: playing, next: null, cue: null };
  }
  if (playing.number === 1 && playing.openings) {
    return { stage: 'openings', onPage: playing, next: null, cue: null };
  }
  if (playing.number === 1) {
    return { stage: 'start', onPage: playing, next: null, cue: null };
  }
  return { stage: 'opening', onPage: playing, next: null, cue: null };
}

async function standingOf(db: Db, all: Scene[]): Promise<Standing> {
  const playing = all.find((scene) => scene.status === 'playing');
  if (playing) {
    return standingOfPlaying(db, playing);
  }
  const waiting = all.find((scene) => scene.status === 'next');
  if (waiting && waiting.number === 1) {
    if (waiting.openings) {
      return { stage: 'openings', onPage: waiting, next: null, cue: null };
    }
    return { stage: 'start', onPage: waiting, next: null, cue: null };
  }
  if (waiting) {
    const ended = all.find((scene) => scene.number === waiting.number - 1) ?? null;
    return { stage: 'ended', onPage: ended, next: waiting, cue: null };
  }
  const last = all.at(-1);
  if (!last) {
    return { stage: 'start', onPage: null, next: null, cue: null };
  }
  return { stage: 'ended', onPage: last, next: null, cue: null };
}

/** The play of a book as the page shows it. */
export async function playView(db: Db, bookId: string): Promise<Play> {
  const [book] = await db.select().from(books).where(eq(books.id, bookId));
  const cast = await castOf(db, bookId);
  const places = new Map(cast.map((person, place) => [person.id, place]));
  const index: CastIndex = { names: namesOf(cast), places };
  const protagonist = cast.find((person) => person.role === 'protagonist');
  if (!book || !protagonist) {
    throw new Error(`Book ${bookId} has no protagonist.`);
  }
  const all = await db.select().from(scenes).where(eq(scenes.bookId, bookId)).orderBy(asc(scenes.number));
  const standing = await standingOf(db, all);

  let scene: SceneHead | null = null;
  let openings: Opening[] | null = null;
  if (standing.onPage) {
    scene = headOf(standing.onPage);
  }
  if (standing.onPage && standing.stage === 'openings') {
    openings = openingsOf(standing.onPage);
  }
  let next: SceneHead | null = null;
  if (standing.next) {
    next = headOf(standing.next);
  }
  let cue: Person | null = null;
  if (standing.cue) {
    cue = { id: standing.cue, name: nameOf(index.names, standing.cue) };
  }
  return {
    bookId,
    title: book.title,
    protagonist: { id: protagonist.id, name: protagonist.name },
    stage: standing.stage,
    scene,
    openings,
    turns: await turnsShown(db, standing.onPage, index),
    cue,
    next,
  };
}
