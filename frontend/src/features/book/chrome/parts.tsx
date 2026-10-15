import type { CSSProperties } from 'react';
import { motion } from 'motion/react';
import { duration, minutesFor } from '../../../lib/format';
import { springs } from '../../../lib/springs';
import { numbered, pad2, type Chapter } from '../chapters';
import { CROSS } from './icons';

const DIGITS = '0123456789'.split('');

/** A number whose digits roll to their new value, like a mechanical counter. */
export function Digits({ value, width }: { value: number; width: number }) {
  const s = String(Math.max(0, Math.round(value))).padStart(width, '0');
  return (
    <span className="dg" aria-label={String(Math.round(value))}>
      {s.split('').map((d, i) => (
        <span key={s.length - i} className="dg-slot" aria-hidden="true">
          <motion.span className="dg-strip" initial={false} animate={{ y: `${-Number(d) * 10}%` }} transition={springs.snappy}>
            {DIGITS.map((n) => <span key={n}>{n}</span>)}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

/** Text that types itself in, one character per step, whenever it changes. Needs a monospaced face. */
export function Typed({ text, className = '' }: { text: string; className?: string }) {
  return <span key={text} className={`typed ${className}`} style={{ '--n': Math.max(1, text.length) } as CSSProperties}>{text}</span>;
}

/** The hover label on a progress track: the chapter's number, title and length. */
export function ChapterLabel({ chapters, i, f }: { chapters: Chapter[]; i: number; f: number }) {
  if (chapters.length < 3) return <span className="lbl"><b>{Math.round(f * 100)}%</b></span>;
  const c = chapters[i];
  return (
    <span className="lbl">
      {!numbered(c.title) && <b>{pad2(i + 1)}</b>}
      <span className="lbl-t">{c.title}</span>
      <em>{duration(minutesFor(c.words))}</em>
    </span>
  );
}

/** `lit` fills the icon with the book's colour from the left, as far as that fraction: loading. */
export function DotIcon({ rows, lit }: { rows: string[]; lit?: number }) {
  const w = rows[0].length;
  const cells = rows.flatMap((r, y) => [...r].map((c, x) => (c === 'x' ? { x, y } : null))).filter((c) => !!c);
  // Column by column, so the fill travels left to right.
  const order = [...cells].sort((a, b) => a.x - b.x || a.y - b.y);
  const on = lit === undefined ? -1 : Math.round(lit * cells.length);
  return (
    <svg className={`i3-dots-icon${lit !== undefined ? ' is-filling' : ''}`} viewBox={`0 0 ${w} ${rows.length}`} style={{ width: `${(w / rows.length) * 0.8}em` }} aria-hidden="true">
      {cells.map((c) => <rect key={`${c.x}.${c.y}`} className={order.indexOf(c) < on ? 'is-lit' : undefined} x={c.x + 0.1} y={c.y + 0.1} width={0.8} height={0.8} rx={0.1} />)}
    </svg>
  );
}

/** The drops' and cards' close button: a cross in square dots, top right. */
export function CloseDots({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="i3-x" onClick={onClick} aria-label="Close">
      <DotIcon rows={CROSS} />
    </button>
  );
}
