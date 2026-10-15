import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { Segmented } from '../../components/Segmented';
import { IconCheck } from '../../components/icons';
import { duration, minutesFor } from '../../lib/format';
import type { Loc } from './FlowView';
import type { FlowBook, TocItem } from './types';
import { FONTS, MEASURES, SIZE_MAX, SIZE_MIN, SPACING, THEMES, styleFor, type ReaderSettings, type StyleSettings } from './settings';

/*
 * The book's drops: its contents, and how it looks. Breader's (features/reader/Panels.tsx), for a
 * book of text, with the book's download and what's still being written at the contents' end.
 */

/* Contents */

interface ContentsProps {
  book: FlowBook;
  loc: Loc | null;
  onGo: (item: TocItem) => void;
  /** What goes under the chapters: the download, and what's still to come. */
  children?: ReactNode;
}

export function ContentsPanel({ book, loc, onGo, children }: ContentsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const items = book.toc;
  const section = loc?.section ?? 0;
  let current = -1;
  items.forEach((it, i) => { if (it.section <= section) current = i; });

  const minutes = (i: number) => {
    const from = items[i].section;
    const to = items.slice(i + 1).find((it) => it.section > from)?.section ?? book.sections.length;
    let w = 0;
    for (let s = from; s < to; s++) w += book.sections[s]?.words ?? 0;
    return w ? duration(minutesFor(w)) : '';
  };

  useEffect(() => {
    listRef.current?.querySelector('.p-item.is-now')?.scrollIntoView({ block: 'center' });
  }, []);

  const pct = Math.round((loc?.progress ?? 0) * 100);
  let left = '';
  if (loc && loc.bookWordsLeft) left = `${duration(minutesFor(loc.bookWordsLeft))} left`;
  else if (loc) left = 'Read to the end';
  return (
    <div className="pnl">
      <div className="pnl-h">Contents</div>
      <div className="p-title">{book.title}</div>
      {book.author && <div className="p-auth">{book.author}</div>}
      <div className="p-bar"><i style={{ width: `${pct}%` }} /></div>
      <div className="p-meta">
        <span>{pct}%</span>
        <span>{left}</span>
      </div>
      <div className="p-list" ref={listRef}>
        {items.map((it, i) => {
          let state = 'next';
          if (i < current) state = 'done';
          if (i === current) state = 'now';
          let side: ReactNode = minutes(i);
          if (state === 'done') side = <IconCheck />;
          if (state === 'now' && loc) side = `${duration(minutesFor(loc.sectionWordsLeft))} left`;
          return (
            <button
              key={`${it.section}-${i}`}
              type="button"
              className={`p-item is-${state}`}
              style={{ paddingLeft: 10 + Math.min(it.level, 3) * 14, '--i': i } as CSSProperties}
              onClick={() => onGo(it)}
            >
              <span className="p-item-t">{it.title}</span>
              <span className="p-item-s">{side}</span>
            </button>
          );
        })}
      </div>
      {children}
    </div>
  );
}

/* Appearance */

interface LookProps {
  settings: ReaderSettings;
  update: (fn: (s: ReaderSettings) => ReaderSettings) => void;
}

const lines = (gap: number) => (
  <svg viewBox="0 0 22 16" aria-hidden="true"><path d={`M3 ${8 - gap}h16M3 8h16M3 ${8 + gap}h16`} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
);
const margins = (inset: number) => (
  <svg viewBox="0 0 22 16" aria-hidden="true">
    <rect x="1" y="1" width="20" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" opacity=".5" />
    <path d={`M${inset} 5h${22 - inset * 2}M${inset} 8h${22 - inset * 2}M${inset} 11h${22 - inset * 2}`} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export function AppearancePanel({ settings, update }: LookProps) {
  const cur = settings[settings.style];
  const set = (patch: Partial<StyleSettings>) => update((s) => ({ ...s, [s.style]: { ...s[s.style], ...patch } }));

  return (
    <div className="pnl">
      <div className="pnl-h">Appearance</div>
      <div className="ctl">
        <div className="clbl">Theme</div>
        <div className="sws" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <button
              key={t.key}
              type="button"
              role="radio"
              aria-checked={settings.theme === t.key}
              aria-label={t.label}
              title={t.label}
              className={`sw t-${t.key}${settings.theme === t.key ? ' is-on' : ''}`}
              onClick={() => update((s) => ({ ...s, theme: t.key }))}
            >
              {t.key === 'auto' ? '' : 'Aa'}
            </button>
          ))}
        </div>
      </div>
      <div className="ctl">
        <div className="clbl">Typeface</div>
        <div className="tfs" role="radiogroup" aria-label="Typeface">
          {FONTS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="radio"
              aria-checked={cur.font === f.key}
              className={cur.font === f.key ? 'is-on' : ''}
              style={{ fontFamily: f.family }}
              onClick={() => set({ font: f.key })}
            >
              {f.label}
              {f.note && <small>{f.note}</small>}
            </button>
          ))}
        </div>
      </div>
      <div className="ctl">
        <div className="clbl">Size</div>
        <div className="stp">
          <button type="button" aria-label="Smaller text" disabled={cur.size <= SIZE_MIN} onClick={() => set({ size: Math.max(SIZE_MIN, cur.size - 1) })}>A−</button>
          <span className="stp-v" aria-live="polite">{cur.size}</span>
          <button type="button" aria-label="Larger text" disabled={cur.size >= SIZE_MAX} onClick={() => set({ size: Math.min(SIZE_MAX, cur.size + 1) })}>A+</button>
        </div>
      </div>
      <div className="two">
        <Segmented label="Spacing" value={cur.lh} onChange={(v) => set({ lh: v })} options={SPACING.map((o, i) => ({ v: o.v, label: o.label, content: lines(4 + i) }))} />
        <Segmented label="Margins" value={cur.measure} onChange={(v) => set({ measure: v })} options={MEASURES.map((o, i) => ({ v: o.v, label: o.label, content: margins(4 + i * 2) }))} />
      </div>
      {/* Pages read as Book, scrolling as Modern, each with its own type. */}
      <Segmented label="Layout" value={cur.layout} onChange={(v) => update((s) => ({ ...s, style: styleFor(v) }))} options={[{ v: 'pages', label: 'Pages' }, { v: 'scroll', label: 'Scroll' }]} />
      <div className="ctl tgrow">
        <span className="clbl">Justify</span>
        <button type="button" className="tg" role="switch" aria-checked={cur.justify} aria-label="Justify text" onClick={() => set({ justify: !cur.justify })} />
      </div>
    </div>
  );
}
