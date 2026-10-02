import type { CSSProperties } from 'react';
import type { Book } from '../../data/books';
import { colorVars, normColor } from '../../data/colors';

/** A book's colour and ink as CSS variables for its card. */
export function bookVars(b: Book): CSSProperties {
  return colorVars(normColor(b.color, b.title));
}
