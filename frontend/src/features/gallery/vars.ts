import type { CSSProperties } from 'react';
import { colorVars } from '../../data/colors';
import type { ShelfItem } from '../../data/useLibrary';

/** A book's colour and ink as CSS variables for its card. */
export function bookVars(b: ShelfItem): CSSProperties {
  return colorVars(b.color);
}
