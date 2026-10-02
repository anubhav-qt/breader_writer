import type { ShelfItem } from '../../data/useLibrary';
import { duration, minutesFor, whenPhrase } from '../../lib/format';

const isNew = (b: ShelfItem) => b.progress <= 0 && !b.opened;
const isDone = (b: ShelfItem) => b.progress >= 1;

export function verbFor(b: ShelfItem) {
  if (b.shared && !b.opened) return 'Shared';
  if (isDone(b)) return 'Finished';
  if (isNew(b)) return 'Added';
  return 'Read';
}

export const when = (b: ShelfItem, now: number) => whenPhrase(verbFor(b), b.lastOpened, now);

export function progressText(b: ShelfItem) {
  if (isDone(b)) return 'Finished';
  const left = duration(minutesFor(b.words * (1 - b.progress)));
  if (isNew(b)) return `Not started · ${left}`;
  return `${Math.round(b.progress * 100)}% · ${left} left`;
}

/** How much is left, in one short phrase. */
export function timeLeft(b: ShelfItem) {
  if (isDone(b)) return 'Finished';
  const m = duration(minutesFor(b.words * (1 - b.progress)));
  return isNew(b) ? `${m} read` : `${Math.round(b.progress * 100)}% · ${m} left`;
}

export const shortProgress = (b: ShelfItem) => (isDone(b) ? 'Finished' : isNew(b) ? 'New' : `${Math.round(b.progress * 100)}%`);


export const actionLabel = (b: ShelfItem) => (isDone(b) ? 'Read again' : isNew(b) ? 'Start reading' : 'Continue');
