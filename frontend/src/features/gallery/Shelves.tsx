import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Book } from '../../data/books';
import { IconBack, IconChevron } from '../../components/icons';
import { byDate, type Shelf } from './shelving';
import { Tile } from './Tile';
import './shelves.css';

/** Cards a row starts with, and adds as it nears its end; shelves the library starts with. */
const PAGE = 20;

interface Props {
  books: Book[];
  /** The library's scroller, which brings in more shelves. */
  root: RefObject<HTMLElement | null>;
  now: number;
  enter: boolean;
  indexBase: number;
  onOpen: (book: Book, rect: DOMRect) => void;
}

/** Below Recent, every book again, by date. Each shelf is a row that scrolls sideways. */
export function Shelves({ books, root, now, enter, indexBase, onOpen }: Props) {
  const shelves = useMemo(() => byDate(books, now), [books, now]);

  return (
    <section className="shelves" aria-labelledby="shelves-title">
      <div className="shelves-head">
        <div className="shelves-title">
          <h2 id="shelves-title">All books</h2>
        </div>
      </div>
      <div className="shelf-list">
        <ShelfList shelves={shelves} root={root} now={now} enter={enter} indexBase={indexBase} onOpen={onOpen} />
      </div>
    </section>
  );
}

type ListProps = Omit<Props, 'books'> & { shelves: Shelf[] };

/** The shelves come in as the library scrolls to them. */
function ShelfList({ shelves, root, ...rest }: ListProps) {
  const [limit, setLimit] = useState(PAGE);
  const end = useRef<HTMLDivElement>(null);
  const more = limit < shelves.length;

  useEffect(() => {
    const el = end.current;
    if (!more || !el) return;
    const io = new IntersectionObserver((seen) => {
      if (seen.some((s) => s.isIntersecting)) setLimit((n) => n + PAGE);
    }, { root: root.current, rootMargin: '0px 0px 900px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [more, limit, root]);

  return (
    <>
      {shelves.slice(0, limit).map((s, i) => <Row key={s.key} shelf={s} index={i} {...rest} />)}
      {more && <div ref={end} className="shelf-more" aria-hidden="true" />}
    </>
  );
}

type RowProps = Omit<ListProps, 'shelves' | 'root'> & { shelf: Shelf; index: number };

/** One shelf: its name, how many, arrows, and its cards in a row that scrolls sideways. */
function Row({ shelf, index, now, enter, indexBase, onOpen }: RowProps) {
  const row = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(PAGE);
  const [ends, setEnds] = useState({ start: true, end: true });
  const total = shelf.books.length;
  const books = shelf.books.slice(0, shown);

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
  const layoutKey = books.map((b) => b.id).join('|');

  return (
    <section className="shelf" aria-label={shelf.name}>
      <header className="shelf-head">
        <h3 className="shelf-name">
          <span>{shelf.name}</span>
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
          {books.map((b, k) => (
            <Tile
              key={b.id}
              book={b}
              variant="cover"
              index={indexBase + index * 2 + k}
              enter={enter}
              now={now}
              radius="8px 18px 18px 8px"
              className="shelf-tile"
              layoutKey={layoutKey}
              onOpen={onOpen}
            />
          ))}
        </AnimatePresence>
      </motion.div>
    </section>
  );
}
