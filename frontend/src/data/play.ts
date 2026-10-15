import { Hints, Play, PlayEvent, Undone, type Going, type MoveAsk, type OpenAsk } from '@writer/shared/play';
import { streamEvents, writer } from '../lib/api';
import { readLocal, writeLocal } from '../lib/store';

/*
 * Play (step 6), from the writer's server. A move streams back as Procreator writes it; asking for
 * the openings or for hints answers once Procreator is done.
 */

/**
 * How long asking for the openings or for hints may take. Procreator thinks as hard as the account
 * picked, and the openings' ask opens the first scene's session too.
 */
const THINKING_TIMEOUT = 600_000;

function playPath(bookId: string, rest = ''): string {
  return `/v1/books/${bookId}/play${rest}`;
}

/** The play as the page shows it. */
export async function fetchPlay(bookId: string): Promise<Play> {
  const data = await writer.get<unknown>(playPath(bookId));
  return Play.parse(data);
}

/** Asks for the first scene's openings. Answers with the play, the openings offered. */
export async function askOpenings(bookId: string, signal: AbortSignal): Promise<Play> {
  const data = await writer.post<unknown>(playPath(bookId, '/openings'), {}, THINKING_TIMEOUT, signal);
  return Play.parse(data);
}

/** Three moves the owner could make next. */
export async function askHints(bookId: string, signal: AbortSignal): Promise<string[]> {
  const data = await writer.post<unknown>(playPath(bookId, '/hints'), {}, THINKING_TIMEOUT, signal);
  return Hints.parse(data).moves;
}

/** Takes the newest turn back: the play, and the owner's words for the box again. */
export async function undoTurn(bookId: string): Promise<Undone> {
  const data = await writer.post<unknown>(playPath(bookId, '/undo'));
  return Undone.parse(data);
}

/** What streams back from a move: the heading, Procreator's words, then the play. */
type OnEvent = (event: PlayEvent) => void;

function streamPlay(bookId: string, rest: string, body: unknown, onEvent: OnEvent, signal: AbortSignal): Promise<void> {
  return streamEvents(playPath(bookId, rest), body, (data) => onEvent(PlayEvent.parse(data)), signal);
}

/** The owner opens the story: an opening offered, or their own. */
export function openStory(bookId: string, ask: OpenAsk, onEvent: OnEvent, signal: AbortSignal): Promise<void> {
  return streamPlay(bookId, '/open', ask, onEvent, signal);
}

/** The owner's move, or a note as the author. */
export function sendMove(bookId: string, ask: MoveAsk, onEvent: OnEvent, signal: AbortSignal): Promise<void> {
  return streamPlay(bookId, '/move', ask, onEvent, signal);
}

/** On to the next scene. */
export function goOn(bookId: string, going: Going, onEvent: OnEvent, signal: AbortSignal): Promise<void> {
  return streamPlay(bookId, '/next', going, onEvent, signal);
}

/** The story has ended, and the owner finishes the book: its last scene is wrapped up. */
export function finishBook(bookId: string, onEvent: OnEvent, signal: AbortSignal): Promise<void> {
  return streamPlay(bookId, '/finish', {}, onEvent, signal);
}

/** Another reply to the newest turn. */
export function another(bookId: string, going: Going, onEvent: OnEvent, signal: AbortSignal): Promise<void> {
  return streamPlay(bookId, '/again', going, onEvent, signal);
}

/** The one about to act is played by their actor this time. */
export function letActorPlay(bookId: string, going: Going, onEvent: OnEvent, signal: AbortSignal): Promise<void> {
  return streamPlay(bookId, '/actor', going, onEvent, signal);
}

/*
 * The switch "Main character and author only", kept in this browser for each book. It's on unless
 * the owner turned it off.
 */
const OTHERS_KEY = 'writer.playOthers.v1';

/** Whether the owner plays others too in this book (the switch off). */
export function readPlayOthers(bookId: string): boolean {
  const books = readLocal<string[]>(OTHERS_KEY, []);
  if (!Array.isArray(books)) {
    return false;
  }
  return books.includes(bookId);
}

export function writePlayOthers(bookId: string, playOthers: boolean) {
  let books = readLocal<string[]>(OTHERS_KEY, []);
  if (!Array.isArray(books)) {
    books = [];
  }
  const others = books.filter((id) => id !== bookId);
  if (playOthers) {
    others.push(bookId);
  }
  writeLocal(OTHERS_KEY, others);
}
