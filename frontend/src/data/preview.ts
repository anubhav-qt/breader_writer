import type { Book } from './books';

/*
 * Development only: placeholder libraries and the notes the library shows instead of books, so
 * each can be looked at without the account or the server they'd need. The preview bar picks one.
 */

/** The notes a preview can show in place of the library. */
export type PreviewNote = 'logged_out' | 'unconfirmed' | 'invite_only' | 'offline';
export type PreviewMode = 'live' | 'empty' | 'one' | 'few' | 'many' | PreviewNote;

export const PREVIEW_MODES: Array<{ id: PreviewMode; label: string }> = [
  { id: 'live', label: 'live' },
  { id: 'empty', label: 'empty' },
  { id: 'one', label: 'one' },
  { id: 'few', label: 'few' },
  { id: 'many', label: 'many' },
  { id: 'logged_out', label: 'logged out' },
  { id: 'unconfirmed', label: 'unconfirmed' },
  { id: 'invite_only', label: 'invite only' },
  { id: 'offline', label: 'offline' },
];

const HOUR = 3_600_000;

interface Seed {
  title: string;
  color: string;
  wordGoal: number;
  /** How much is written, from 0 to 1. */
  share: number;
  hoursAgo: number;
}

/* Made up stories, at every length and every stage, played over the last few months. */
const SEEDS: Seed[] = [
  { title: 'Salt and Iron', color: 'teal', wordGoal: 80000, share: 0.42, hoursAgo: 2 },
  { title: 'The Clockmaker’s Debt', color: 'clay', wordGoal: 30000, share: 0.8, hoursAgo: 20 },
  { title: 'Reincarnated as the Villain’s Butler, I Refuse to Let Him Lose', color: 'lilac', wordGoal: 50000, share: 0.3, hoursAgo: 30 },
  { title: 'A Quiet Kind of Storm', color: 'sky', wordGoal: 8000, share: 1, hoursAgo: 52 },
  { title: 'Ninth Bell', color: 'graphite', wordGoal: 8000, share: 0, hoursAgo: 70 },
  { title: 'Where the Rivers Forget', color: 'moss', wordGoal: 80000, share: 0.12, hoursAgo: 100 },
  { title: 'The Cartographer of Ash', color: 'ochre', wordGoal: 30000, share: 0.55, hoursAgo: 130 },
  { title: 'Lanterns Under Kestrel Hill', color: 'green', wordGoal: 80000, share: 0.05, hoursAgo: 190 },
  { title: 'My Classmate Is a Retired Demon Lord and Keeps Asking Me for Homework Help', color: 'rose', wordGoal: 50000, share: 0.66, hoursAgo: 240 },
  { title: 'Glass Orchard', color: 'sage', wordGoal: 8000, share: 0.5, hoursAgo: 300 },
  { title: 'The Last Train to Vell', color: 'indigo', wordGoal: 30000, share: 0, hoursAgo: 420 },
  { title: 'Hollow Crown, Burning Sea', color: 'plum', wordGoal: 80000, share: 0.9, hoursAgo: 600 },
  { title: 'Small Gods of the Kitchen', color: 'sand', wordGoal: 8000, share: 1, hoursAgo: 800 },
  { title: 'The Winter Ledger', color: 'blush', wordGoal: 30000, share: 0.25, hoursAgo: 1000 },
  { title: 'Seven Doors in Marrow Street', color: 'teal', wordGoal: 80000, share: 0.33, hoursAgo: 1300 },
  { title: 'Ashfall', color: 'clay', wordGoal: 50000, share: 0.1, hoursAgo: 1700 },
  { title: 'The Moth Archive', color: 'ochre', wordGoal: 30000, share: 1, hoursAgo: 2200 },
  { title: 'Letters to a Drowned City', color: 'sky', wordGoal: 80000, share: 0.6, hoursAgo: 3000 },
  { title: 'The Summer the Bees Left', color: 'moss', wordGoal: 8000, share: 0.75, hoursAgo: 4000 },
  { title: 'Iron Saints', color: 'graphite', wordGoal: 80000, share: 0, hoursAgo: 6000 },
];

function bookFrom(seed: Seed, index: number, now: number): Book {
  const updatedAt = now - seed.hoursAgo * HOUR;
  return {
    id: `preview-${index}`,
    title: seed.title,
    color: seed.color,
    wordGoal: seed.wordGoal,
    wordsWritten: Math.round(seed.wordGoal * seed.share),
    createdAt: updatedAt - 72 * HOUR,
    updatedAt,
  };
}

/** The placeholder books a preview shows, or null when it shows the live library or a note. */
export function previewBooks(mode: PreviewMode, now: number): Book[] | null {
  const all = SEEDS.map((seed, i) => bookFrom(seed, i, now));
  if (mode === 'empty') return [];
  if (mode === 'one') return all.slice(0, 1);
  if (mode === 'few') return all.slice(0, 6);
  if (mode === 'many') return all;
  return null;
}

/** The note a preview shows in place of the library, or null when it shows books. */
export function previewNote(mode: PreviewMode): PreviewNote | null {
  if (mode === 'logged_out' || mode === 'unconfirmed' || mode === 'invite_only' || mode === 'offline') return mode;
  return null;
}
