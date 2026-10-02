import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { ShelfItem } from '../../data/useLibrary';
import { readLocal, writeLocal } from '../../lib/store';
import { springs } from '../../lib/springs';
import { IconBack, IconChevron } from '../../components/icons';
import { finishedIn, type Series } from './series';
import { VIEWS, byDate, byGenre, bySeries, isView, type Shelf, type View } from './shelving';
import { Tile } from './Tile';
import './shelves.css';

/** Cards a row starts with, and adds as it nears its end; shelves the series and dates start with. */
const PAGE = 20;

interface Props {
  books: ShelfItem[];
  /** Series of two or more books, by book id: one card each on a genre's shelf. */
  stacks: Map<string, Series>;
  /** Every series, however few books, by book id. */
  series: Map<string, Series>;
  /** The name a series' cards go by, by book id. */
  authors: Map<string, string>;
  /** Which library: the choice of view is kept for each. */
  place: string;
  /** The view it starts with until the reader picks one. */
  initial: View;
  /** The library's scroller, which brings in more shelves. */
  root: RefObject<HTMLElement | null>;
  now: number;
  enter: boolean;
  indexBase: number;
  editingId?: string;
  onOpen: (book: ShelfItem, rect: DOMRect) => void;
  onEdit: (book: ShelfItem, anchor: HTMLElement) => void;
  onSeries: (s: Series) => void;
}

/**
 * Below Recent, the whole library again: by genre, by series or by date, picked on the right of
 * the heading. Each shelf is a row that scrolls sideways.
 */
export function Shelves({ books, stacks, series, authors, place, initial, root, now, enter, indexBase, editingId, onOpen, onEdit, onSeries }: Props) {
  const key = `breader.view.${place}.v1`;
  const [picked, setPicked] = useState<View | null>(() => {
    const v = readLocal<unknown>(key, null);
    return isView(v) ? v : null;
  });
  // A library with no series yet starts on its genres.
  const view = picked ?? (initial === 'series' && !series.size ? 'genre' : initial);
  const section = useRef<HTMLElement>(null);
  const tabs = useRef<HTMLDivElement>(null);

  const pick = (v: View) => {
    if (v === view) return;
    setPicked(v);
    writeLocal(key, v);
    const el = section.current;
    const scroller = root.current;
    if (!el || !scroller) return;
    // Read from the top of the new view, when the old one was scrolled past its heading.
    if (el.getBoundingClientRect().top < scroller.getBoundingClientRect().top) scroller.scrollTop = el.offsetTop;
    // The old view leaves before the new one arrives, and the library would be short enough in
    // between to pull the page up: it keeps its height until the new view is in.
    el.style.minHeight = `${el.offsetHeight}px`;
  };
  useLayoutEffect(() => {
    const el = section.current;
    if (!el?.style.minHeight) return;
    const f = requestAnimationFrame(() => { el.style.minHeight = ''; });
    return () => cancelAnimationFrame(f);
  }, [view]);
  const onArrow = (e: KeyboardEvent) => {
    const i = VIEWS.findIndex((v) => v.id === view);
    const to = ({ ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: VIEWS.length - 1 } as Record<string, number>)[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const next = VIEWS[(to + VIEWS.length) % VIEWS.length].id;
    pick(next);
    tabs.current?.querySelector<HTMLElement>(`[data-view="${next}"]`)?.focus();
  };

  const shelves = useMemo(() => {
    if (view === 'genre') return byGenre(books, stacks);
    if (view === 'series') return bySeries(series.values());
    return byDate(books, now);
  }, [view, books, stacks, series, now]);
  const title = VIEWS.find((v) => v.id === view)!.title;
  const panel = `${place}-shelves`;

  return (
    <section ref={section} className="shelves" aria-labelledby={`${panel}-title`}>
      <div className="shelves-head">
        <div className="shelves-title">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.h2
              key={title}
              id={`${panel}-title`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8, transition: { duration: 0.12 } }}
              transition={springs.smooth}
            >
              {title}
            </motion.h2>
          </AnimatePresence>
        </div>
        <div ref={tabs} className="views" role="tablist" aria-label="Shelve by" onKeyDown={onArrow}>
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              className="view-tab"
              data-view={v.id}
              aria-selected={view === v.id}
              aria-controls={panel}
              tabIndex={view === v.id ? 0 : -1}
              onClick={() => pick(v.id)}
            >
              {v.label}
              {view === v.id && <motion.span className="view-line" layoutId={`view-line-${place}`} transition={springs.snappy} />}
            </button>
          ))}
        </div>
      </div>
      <motion.div
        key={view}
        id={panel}
        role="tabpanel"
        aria-labelledby={`${panel}-title`}
        className="shelf-list"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springs.smooth}
      >
        <ShelfList
          shelves={shelves}
          // Genres all show at once; series and dates come in as the library scrolls to them.
          lazy={view !== 'genre'}
          empty={view === 'series' ? 'No series yet. Give two books the same series name and they gather here.' : undefined}
          authors={authors}
          root={root}
          now={now}
          enter={enter}
          indexBase={indexBase}
          editingId={editingId}
          onOpen={onOpen}
          onEdit={onEdit}
          onSeries={onSeries}
        />
      </motion.div>
    </section>
  );
}

type ListProps = Pick<Props, 'authors' | 'root' | 'now' | 'enter' | 'indexBase' | 'editingId' | 'onOpen' | 'onEdit' | 'onSeries'> & {
  shelves: Shelf[];
  lazy: boolean;
  empty?: string;
};

function ShelfList({ shelves, lazy, empty, root, ...rest }: ListProps) {
  const [limit, setLimit] = useState(PAGE);
  const end = useRef<HTMLDivElement>(null);
  const more = lazy && limit < shelves.length;

  useEffect(() => {
    const el = end.current;
    if (!more || !el) return;
    const io = new IntersectionObserver((seen) => {
      if (seen.some((s) => s.isIntersecting)) setLimit((n) => n + PAGE);
    }, { root: root.current, rootMargin: '0px 0px 900px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [more, limit, root]);

  if (!shelves.length && empty) return <p className="shelf-empty">{empty}</p>;
  return (
    <>
      {(lazy ? shelves.slice(0, limit) : shelves).map((s, i) => <Row key={s.key} shelf={s} index={i} {...rest} />)}
      {more && <div ref={end} className="shelf-more" aria-hidden="true" />}
    </>
  );
}

type RowProps = Omit<ListProps, 'shelves' | 'lazy' | 'empty' | 'root'> & { shelf: Shelf; index: number };

/** One shelf: its name, how many, arrows, and its cards in a row that scrolls sideways. */
function Row({ shelf, index, authors, now, enter, indexBase, editingId, onOpen, onEdit, onSeries }: RowProps) {
  const row = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(PAGE);
  const [ends, setEnds] = useState({ start: true, end: true });
  const total = shelf.entries.length;
  const entries = shelf.entries.slice(0, shown);

  const check = useCallback(() => {
    const el = row.current;
    if (!el || !el.clientWidth) return;
    const left = el.scrollLeft;
    const max = el.scrollWidth - el.clientWidth;
    // Within a screen of the end: the next cards come in.
    if (shown < total && left > max - el.clientWidth) setShown((n) => Math.min(total, n + PAGE));
    const start = left <= 1;
    const end = left >= max - 1 && shown >= total;
    setEnds((was) => (was.start === start && was.end === end ? was : { start, end }));
  }, [shown, total]);
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    check();
    return () => ro.disconnect();
  }, [check]);

  const go = (dir: 1 | -1) => {
    const el = row.current;
    if (!el) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: dir * Math.max(160, el.clientWidth - 120), behavior: still ? 'auto' : 'smooth' });
  };
  const s = shelf.series;
  const layoutKey = entries.map((e) => e.key).join('|');

  return (
    <section className="shelf" aria-label={shelf.name}>
      <header className="shelf-head">
        <h3 className="shelf-name">
          {s ? (
            <button type="button" aria-haspopup="dialog" onClick={() => onSeries(s)}>
              <span>{shelf.name}</span>
              <IconChevron aria-hidden="true" />
            </button>
          ) : (
            <span>{shelf.name}</span>
          )}
        </h3>
        <span className="shelf-meta">{shelf.meta}</span>
        <span className={`shelf-nav${ends.start && ends.end ? ' is-idle' : ''}`}>
          <button type="button" className="shelf-arrow" aria-label={`Back through ${shelf.name}`} disabled={ends.start} onClick={() => go(-1)}>
            <IconBack />
          </button>
          <button type="button" className="shelf-arrow" aria-label={`On through ${shelf.name}`} disabled={ends.end} onClick={() => go(1)}>
            <IconChevron />
          </button>
        </span>
      </header>
      <motion.div ref={row} className="shelf-row" data-start={ends.start || undefined} data-end={ends.end || undefined} onScroll={check} layoutScroll>
        <AnimatePresence mode="popLayout" initial={false}>
          {entries.map((e, k) => {
            const stack = e.stack;
            return (
              <Tile
                key={e.key}
                item={{ key: e.key, book: e.book, author: authors.get(e.book.id) }}
                variant="cover"
                index={indexBase + index * 2 + k}
                enter={enter}
                now={now}
                radius="8px 18px 18px 8px"
                className="shelf-tile"
                number={e.number}
                stack={stack && { name: stack.name, count: stack.books.length, finished: finishedIn(stack) }}
                open={!stack && (e.book.key ?? e.book.id) === editingId}
                layoutKey={layoutKey}
                onOpen={stack ? () => onSeries(stack) : onOpen}
                onEdit={onEdit}
              />
            );
          })}
        </AnimatePresence>
      </motion.div>
    </section>
  );
}
