import { written, type Book } from '../../data/books';
import { whenPhrase } from '../../lib/format';

const isNew = (b: Book) => b.wordsWritten <= 0;
const isDone = (b: Book) => written(b) >= 1;

const count = (n: number) => n.toLocaleString('en-GB');
const percent = (b: Book) => `${Math.round(written(b) * 100)}%`;

function verbFor(b: Book) {
  if (isDone(b)) return 'Finished';
  if (isNew(b)) return 'Made';
  return 'Played';
}

/** "Played yesterday", "Made on Sunday", "Finished in August". */
export const when = (b: Book, now: number) => whenPhrase(verbFor(b), b.updatedAt, now);

/** How much is written, in full. */
export function progressText(b: Book) {
  if (isDone(b)) return 'Finished';
  if (isNew(b)) return `Not started · ${count(b.wordGoal)} words`;
  return `${count(b.wordsWritten)} of ${count(b.wordGoal)} words`;
}

/** How much is left, in one short phrase. */
export function wordsLeft(b: Book) {
  if (isDone(b)) return 'Finished';
  if (isNew(b)) return `${count(b.wordGoal)} words`;
  const left = b.wordGoal - b.wordsWritten;
  return `${percent(b)} · ${count(left)} to go`;
}

export function shortProgress(b: Book) {
  if (isDone(b)) return 'Finished';
  if (isNew(b)) return 'New';
  return percent(b);
}

export function actionLabel(b: Book) {
  if (isDone(b)) return 'Read';
  if (isNew(b)) return 'Start';
  return 'Continue';
}
