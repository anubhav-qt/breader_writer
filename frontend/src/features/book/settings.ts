import { useCallback, useEffect, useState } from 'react';
import { readLocal, writeLocal } from '../../lib/store';

/*
 * How the book reads: breader's reader settings (breader's features/reader/settings.ts), cut down
 * to a book of text. Kept in this browser under the writer's own key, so the writer's book and
 * breader's books are each read as their reader likes.
 */

export type Style = 'book' | 'modern';
export type ThemeName = 'auto' | 'day' | 'warm' | 'dusk' | 'night';
export type FontKey = 'dongle' | 'oxanium' | 'literata' | 'garamond' | 'atkinson';
export type Layout = 'pages' | 'scroll';

export interface StyleSettings {
  font: FontKey;
  size: number;
  lh: number;
  measure: number;
  layout: Layout;
  justify: boolean;
}

export interface ReaderSettings {
  /** Pages read as Book and scroll as Modern: the layout picks it (styleFor). */
  style: Style;
  theme: ThemeName;
  book: StyleSettings;
  modern: StyleSettings;
}

/** Reading typefaces. */
export const FONTS: Array<{ key: FontKey; label: string; family: string; note?: string }> = [
  { key: 'dongle', label: 'Dongle', family: 'var(--read)', note: 'default' },
  { key: 'oxanium', label: 'Oxanium', family: 'var(--oxanium)' },
  { key: 'literata', label: 'Literata', family: 'var(--serif)' },
  { key: 'garamond', label: 'EB Garamond', family: 'var(--garamond)' },
  { key: 'atkinson', label: 'Atkinson Hyperlegible', family: 'var(--atkinson)' },
];

export const THEMES: Array<{ key: ThemeName; label: string }> = [
  { key: 'auto', label: 'Auto' },
  { key: 'day', label: 'Day' },
  { key: 'warm', label: 'Warm' },
  { key: 'dusk', label: 'Dusk' },
  { key: 'night', label: 'Night' },
];

export const SIZE_MIN = 15;
export const SIZE_MAX = 32;
export const SPACING = [
  { v: 1.3, label: 'Tight spacing' },
  { v: 1.45, label: 'Normal spacing' },
  { v: 1.65, label: 'Loose spacing' },
];
export const MEASURES = [
  { v: 720, label: 'Narrow margins' },
  { v: 620, label: 'Medium margins' },
  { v: 540, label: 'Wide margins' },
];

const DEFAULTS: ReaderSettings = {
  style: 'book',
  theme: 'auto',
  book: { font: 'dongle', size: 22, lh: 1.45, measure: 620, layout: 'pages', justify: false },
  modern: { font: 'dongle', size: 22, lh: 1.65, measure: 620, layout: 'scroll', justify: false },
};

/** The style a layout reads in: pages are a book's, scrolling is modern. */
export function styleFor(layout: Layout): Style {
  if (layout === 'pages') {
    return 'book';
  }
  return 'modern';
}

const KEY = 'writer.reader.v1';

function loadSettings(): ReaderSettings {
  const saved = readLocal<Partial<ReaderSettings>>(KEY, {});
  return {
    ...DEFAULTS,
    ...saved,
    book: { ...DEFAULTS.book, ...saved.book },
    modern: { ...DEFAULTS.modern, ...saved.modern },
  };
}

/** The reader's settings, kept in this browser as they change, and taken from another tab when they change there. */
export function useReaderSettings() {
  const [settings, setSettings] = useState<ReaderSettings>(loadSettings);
  useEffect(() => {
    const elsewhere = (e: StorageEvent) => {
      if (e.key === KEY) {
        setSettings(loadSettings());
      }
    };
    window.addEventListener('storage', elsewhere);
    return () => window.removeEventListener('storage', elsewhere);
  }, []);
  const update = useCallback((fn: (s: ReaderSettings) => ReaderSettings) => {
    setSettings((s) => {
      const next = fn(s);
      writeLocal(KEY, next);
      return next;
    });
  }, []);
  return [settings, update] as const;
}

export function fontFamily(key: FontKey): string {
  const font = FONTS.find((f) => f.key === key);
  if (!font) {
    return 'var(--read)';
  }
  return font.family;
}
