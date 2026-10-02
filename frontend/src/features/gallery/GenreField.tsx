import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { GENRES, UNSET_GENRE, genreIds, genreNames, joinGenres } from '@breader/shared/genres';
import { springs } from '../../lib/springs';
import { IconChevron, IconClose } from '../../components/icons';
import './genre.css';

interface Props {
  id?: string;
  /** The genres it's filed under, as stored ("fantasy,romance"); undefined or '' for none. */
  value?: string;
  /** Whose picks it came with, marked in the list: "Sharer’s pick" on a copy of a shared book. */
  added?: { genres?: string; label: string };
  /**
   * The genres of the rest of its series, each book's as stored, when it's in one: each genre then
   * asks whether it's for this book or all of them.
   */
  others?: Array<string | undefined>;
  /** The field's own look: the dialog's or the popover's input. */
  className?: string;
  onPick: (genres: string) => void;
  /** Puts a genre on every book in the series, or takes it off them all. */
  onSeries?: (genre: string, on: boolean) => void;
}

/** A field that shows a book's genres and opens the list of genres to pick them. */
export function GenreField({ id, value, added, others, className = '', onPick, onSeries }: Props) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const names = genreNames(value);
  const close = () => {
    setOpen(false);
    button.current?.focus({ preventScroll: true });
  };
  return (
    <>
      <button
        ref={button}
        id={id}
        type="button"
        className={`genre-field ${className}${names ? '' : ' is-unset'}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span>{names ?? UNSET_GENRE}</span>
        <IconChevron aria-hidden="true" />
      </button>
      <AnimatePresence>
        {open && (
          <GenrePicker
            value={value}
            added={added}
            others={onSeries && others?.length ? others : undefined}
            onPick={onPick}
            onSeries={onSeries}
            onClose={close}
          />
        )}
      </AnimatePresence>
    </>
  );
}

/** What asking about a genre on a book in a series offers: two ways to change it, both at hand. */
function choices(name: string, here: boolean, all: number, total: number) {
  if (!here) return { title: `Add ${name} to`, one: 'This book', every: `All ${total}`, on: true };
  if (all === total) return { title: `Take ${name} off`, one: 'This book', every: `All ${total}`, on: false };
  return { title: `${name} is on ${all} of ${total}`, one: 'Off this book', every: `On all ${total}`, on: true };
}

/**
 * The genres as tiles, over whatever opened it: the add dialog or a card's popover. Each tap puts
 * one on or takes it off at once; on a book in a series it asks first, this book or all of them.
 * It takes Escape and Tab for itself, so neither reaches the dialog or popover underneath.
 */
function GenrePicker({ value, added, others, onPick, onSeries, onClose }: Omit<Props, 'id' | 'className'> & { onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const escape = useRef(onClose);
  escape.current = () => (asking ? setAsking(null) : onClose());

  const picked: string[] = genreIds(value);
  const theirs: string[] = added ? genreIds(added.genres) : [];
  const lists = (others ?? []).map((o) => genreIds(o) as string[]);
  const total = lists.length + 1;
  const having = (g: string) => lists.filter((l) => l.includes(g)).length + (picked.includes(g) ? 1 : 0);

  useEffect(() => {
    const on = grid.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? grid.current?.querySelector<HTMLElement>('button');
    on?.focus({ preventScroll: true });
    on?.scrollIntoView({ block: 'nearest' });
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      escape.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // The question opens under its tile's row, and its first answer takes the focus.
  useEffect(() => {
    if (asking) grid.current?.querySelector<HTMLElement>('.gp-ask button')?.focus({ preventScroll: true });
  }, [asking]);

  const tile = (g: string) => grid.current?.querySelector<HTMLElement>(`[data-genre="${g}"]`);
  const here = (g: string, on: boolean) => onPick(joinGenres(on ? [...picked, g] : picked.filter((x) => x !== g)));
  const answer = (g: string, all: boolean, on: boolean) => {
    if (all) onSeries?.(g, on);
    else here(g, on);
    setAsking(null);
    tile(g)?.focus({ preventScroll: true });
  };
  const tap = (g: string) => {
    if (others) setAsking((cur) => (cur === g ? null : g));
    else here(g, !picked.includes(g));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const els = Array.from(panel.current?.querySelectorAll<HTMLElement>('button') ?? []);
    const at = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Tab') {
      e.preventDefault();
      els[(at + (e.shiftKey ? -1 : 1) + els.length) % els.length]?.focus();
      return;
    }
    // Arrows move through the tiles, a row at a time up and down.
    const tiles = Array.from(grid.current?.querySelectorAll<HTMLElement>('.gp-tile') ?? []);
    const i = tiles.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const cols = grid.current ? getComputedStyle(grid.current).gridTemplateColumns.split(' ').length : 1;
    const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
    if (!move) return;
    e.preventDefault();
    tiles[Math.max(0, Math.min(tiles.length - 1, i + move))]?.focus();
  };

  // The question goes after the last tile in the asked one's row.
  const cols = 2;
  const askAfter = asking ? Math.min(GENRES.length - 1, GENRES.findIndex((g) => g.id === asking) - (GENRES.findIndex((g) => g.id === asking) % cols) + cols - 1) : -1;
  const asked = asking ? GENRES.find((g) => g.id === asking) : undefined;
  const ask = asked && choices(asked.name, picked.includes(asked.id), having(asked.id), total);

  return createPortal(
    <div className="gp-root">
      <motion.div className="gp-scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} />
      <motion.div
        ref={panel}
        className="gp"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gp-title"
        aria-describedby="gp-note"
        onKeyDown={onKeyDown}
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 4, transition: { duration: 0.14 } }}
        transition={springs.snappy}
      >
        <div className="gp-head">
          <h2 className="gp-title" id="gp-title">Genres</h2>
          {picked.length > 0 && (
            <button type="button" className="gp-clear" onClick={() => { setAsking(null); onPick(''); }} aria-label={others ? 'Clear this book’s genres' : 'Clear the genres'}>
              Clear
            </button>
          )}
          <button type="button" className="gp-x" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>
        <p className="gp-note" id="gp-note">
          {others ? `As many as fit. Each one asks: this book, or all ${total} in the series.` : 'As many as fit.'}
        </p>
        <div ref={grid} className="gp-grid" role="group" aria-labelledby="gp-title">
          {GENRES.map((g, i) => {
            const on = picked.includes(g.id);
            const n = others ? having(g.id) : 0;
            return [
              <button
                key={g.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                aria-expanded={others ? asking === g.id : undefined}
                data-genre={g.id}
                className={`gp-tile${on ? ' is-on' : ''}${asking === g.id ? ' is-asking' : ''}`}
                onClick={() => tap(g.id)}
              >
                <span className="gp-text">
                  <span className="gp-name">{g.name}</span>
                  {theirs.includes(g.id) && <span className="gp-tag">{added!.label}</span>}
                </span>
                {n > 0 && <span className="gp-count" aria-label={`on ${n} of ${total} in the series`}>{n}/{total}</span>}
                <span className="gp-dot" aria-hidden="true" />
              </button>,
              i === askAfter && ask && asked && (
                <div key="ask" className="gp-ask" role="group" aria-label={ask.title}>
                  <span className="gp-ask-title">{ask.title}</span>
                  <div className="gp-ask-row">
                    <button type="button" onClick={() => answer(asked.id, false, !picked.includes(asked.id))}>{ask.one}</button>
                    <button type="button" onClick={() => answer(asked.id, true, ask.on)}>{ask.every}</button>
                  </div>
                </div>
              ),
            ];
          })}
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
