import type { Variant } from '../Tile';

/** [column, row, columns wide, rows tall, variant] on the bento grid, zero-based. */
export type Slot = [col: number, row: number, cols: number, rows: number, variant: Variant];

export const RECENT = 9;

const TOP: Slot[] = [[0, 0, 3, 3, 'hero'], [3, 0, 3, 2, 'square'], [3, 2, 3, 1, 'wide']];

/*
 * One arrangement per count, each tiling the grid with no gaps, so a library of any size up to
 * nine looks composed rather than like a template waiting to be filled.
 */
const BY_COUNT: Record<number, Slot[]> = {
  1: [[1, 0, 4, 3, 'hero']],
  2: [[0, 0, 3, 3, 'hero'], [3, 0, 3, 3, 'square']],
  3: TOP,
  4: [[0, 0, 3, 3, 'hero'], [3, 0, 3, 2, 'square'], [3, 2, 1, 1, 'small'], [4, 2, 2, 1, 'wide']],
  5: [[0, 0, 3, 3, 'hero'], [3, 0, 2, 2, 'square'], [5, 0, 1, 2, 'tall'], [3, 2, 1, 1, 'small'], [4, 2, 2, 1, 'wide']],
  6: [...TOP, [0, 3, 2, 2, 'square'], [2, 3, 2, 2, 'square'], [4, 3, 2, 2, 'square']],
  7: [...TOP, [0, 3, 2, 2, 'square'], [2, 3, 1, 2, 'tall'], [3, 3, 2, 2, 'square'], [5, 3, 1, 2, 'tall']],
  8: [...TOP, [0, 3, 2, 1, 'wide'], [0, 4, 2, 1, 'wide'], [2, 3, 1, 2, 'tall'], [3, 3, 1, 2, 'tall'], [4, 3, 2, 2, 'square']],
  9: [...TOP, [0, 3, 2, 2, 'square'], [2, 3, 1, 2, 'tall'], [3, 3, 1, 1, 'small'], [4, 3, 2, 1, 'wide'], [3, 4, 1, 1, 'small'], [4, 4, 2, 1, 'wide']],
};

/*
 * Four columns, for narrower windows. The hero takes the full width, and the rest pack below it
 * in two-row blocks that each fill all four columns.
 */
const HERO: Slot = [0, 0, 4, 3, 'hero'];
const pair = (r: number): Slot[] => [[0, r, 2, 2, 'square'], [2, r, 2, 2, 'square']];
const stack = (r: number): Slot[] => [[0, r, 2, 2, 'square'], [2, r, 2, 1, 'wide'], [2, r + 1, 2, 1, 'wide']];
const trio = (r: number): Slot[] => [[0, r, 2, 2, 'square'], [2, r, 1, 2, 'tall'], [3, r, 1, 2, 'tall']];
const quad = (r: number): Slot[] => [[0, r, 1, 2, 'tall'], [1, r, 1, 1, 'small'], [1, r + 1, 1, 1, 'small'], [2, r, 2, 2, 'square']];

const BY_COUNT_4: Record<number, Slot[]> = {
  1: [HERO],
  2: [HERO, [0, 3, 4, 2, 'square']],
  3: [HERO, ...pair(3)],
  4: [HERO, ...stack(3)],
  5: [HERO, ...quad(3)],
  6: [HERO, ...trio(3), ...pair(5)],
  7: [HERO, ...trio(3), ...stack(5)],
  8: [HERO, ...trio(3), ...quad(5)],
  9: [HERO, ...trio(3), ...quad(5), [0, 7, 4, 1, 'wide']],
};

/*
 * Two columns, for phones. The hero, then wide cards across and tall ones in pairs, so every
 * row is full whatever the count.
 */
const PHONE_HERO: Slot = [0, 0, 2, 3, 'hero'];
const PHONE_PATTERNS: Record<number, Array<'W' | 'TT'>> = {
  1: [],
  2: ['W'],
  3: ['TT'],
  4: ['W', 'TT'],
  5: ['W', 'TT', 'W'],
  6: ['TT', 'W', 'TT'],
  7: ['W', 'TT', 'W', 'TT'],
  8: ['W', 'TT', 'W', 'TT', 'W'],
  9: ['W', 'TT', 'W', 'TT', 'TT'],
};
function phone(n: number): Slot[] {
  const out: Slot[] = [PHONE_HERO];
  let row = 3;
  for (const p of PHONE_PATTERNS[n]) {
    if (p === 'W') {
      out.push([0, row, 2, 1, 'wide']);
      row += 1;
    } else {
      out.push([0, row, 1, 2, 'tall'], [1, row, 1, 2, 'tall']);
      row += 2;
    }
  }
  return out;
}
const BY_COUNT_2: Record<number, Slot[]> = Object.fromEntries(Array.from({ length: RECENT }, (_, i) => [i + 1, phone(i + 1)]));

export const slotsFor = (n: number, cols: number): Slot[] =>
  (cols === 4 ? BY_COUNT_4 : cols === 2 ? BY_COUNT_2 : BY_COUNT)[Math.max(1, Math.min(RECENT, n))];
