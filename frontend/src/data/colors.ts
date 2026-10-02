import type { CSSProperties } from 'react';

/** Solid book colours. Each has a deeper shade for light pages and a brighter one for dark pages in tokens.css, each with a legible ink. */
export const BOOK_COLORS = [
  { key: 'rose', label: 'Rose' },
  { key: 'clay', label: 'Clay' },
  { key: 'ochre', label: 'Ochre' },
  { key: 'sand', label: 'Sand' },
  { key: 'sage', label: 'Sage' },
  { key: 'moss', label: 'Moss' },
  { key: 'green', label: 'Lamp green' },
  { key: 'teal', label: 'Teal' },
  { key: 'sky', label: 'Sky' },
  { key: 'indigo', label: 'Indigo' },
  { key: 'lilac', label: 'Lilac' },
  { key: 'plum', label: 'Plum' },
  { key: 'blush', label: 'Blush' },
  { key: 'graphite', label: 'Graphite' },
] as const;

export type BookColor = (typeof BOOK_COLORS)[number]['key'];

const KEYS = new Set<string>(BOOK_COLORS.map((c) => c.key));

/** A stable default colour picked from the title. */
export function colorKeyFor(title: string): BookColor {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) | 0;
  return BOOK_COLORS[Math.abs(h) % BOOK_COLORS.length].key;
}

/**
 * A colour for a new book: a random one of those the library has given out least. So each colour
 * leaves the pool once used, and the pool refills only when every colour has been used. `given`
 * is the colour each book was first given; recolouring a book later doesn't count.
 */
export function pickColor(given: string[]): BookColor {
  const counts = new Map<string, number>(BOOK_COLORS.map((c) => [c.key, 0]));
  for (const g of given) if (counts.has(g)) counts.set(g, counts.get(g)! + 1);
  const least = Math.min(...counts.values());
  const pool = [...counts].filter(([, n]) => n === least).map(([k]) => k as BookColor);
  return pool[Math.floor(Math.random() * pool.length)];
}

/** The book's colour, or one picked from its title when it isn't one of the palette's. */
export function normColor(value: string | undefined, title: string): BookColor {
  if (value && KEYS.has(value)) return value as BookColor;
  return colorKeyFor(title);
}

export function colorVars(key: string): CSSProperties {
  return { '--bc': `var(--bc-${key})`, '--bc-ink': `var(--bc-${key}-ink)` } as CSSProperties;
}
