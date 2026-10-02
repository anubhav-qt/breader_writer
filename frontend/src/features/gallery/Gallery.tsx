import { useEffect, useMemo, useRef } from 'react';
import { motion } from 'motion/react';
import type { Book } from '../../data/books';
import { Bento } from './layouts/Bento';
import { RECENT } from './layouts/slots';
import { Shelves } from './Shelves';
import { TitleHint } from './TitleHint';
import './gallery.css';

interface Props {
  /** Most recent first. The library shows a note instead while there are none. */
  books: Book[];
  now: number;
  /** The panel's id, and the id of the tab that labels it. */
  id: string;
  labelledBy: string;
  onOpen: (book: Book, rect: DOMRect) => void;
}

/** The cards rise in and their colour grows only the first time a library appears after the page loads. */
let entered = false;

/**
 * The library: the most recent books as a bento block, one card per book. Below it, once there
 * are more than Recent holds, every book again by date (Shelves).
 */
export function Gallery({ books, now, id, labelledBy, onOpen }: Props) {
  const first = useRef(!entered);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = window.setTimeout(() => { first.current = false; entered = true; }, 60);
    return () => window.clearTimeout(t);
  }, []);

  const recent = useMemo(() => books.slice(0, RECENT), [books]);
  // "Recent" only means something when more books follow it.
  const more = books.length > RECENT;

  return (
    <motion.div id={id} role="tabpanel" aria-labelledby={labelledBy} ref={scrollRef} className="gallery" layoutScroll>
      <section className="recent" aria-label="Recent">
        {more ? <div className="gallery-head"><span>Recent</span></div> : <div className="gallery-top" />}
        <Bento books={recent} now={now} enter={first.current} onOpen={onOpen} />
      </section>
      {more && <Shelves books={books} root={scrollRef} now={now} enter={first.current} indexBase={RECENT} onOpen={onOpen} />}
      <TitleHint root={scrollRef} />
    </motion.div>
  );
}
