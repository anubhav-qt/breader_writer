import { AnimatePresence } from 'motion/react';
import { useElementWidth } from '../useElementWidth';
import { Tile } from '../Tile';
import type { SectionProps } from '../types';
import { slotsFor } from './slots';

export function Bento({ books, now, enter, onOpen }: SectionProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const cols = width >= 1000 ? 6 : width >= 640 ? 4 : 2;
  const slots = slotsFor(books.length, cols);
  const layoutKey = books.map((b) => b.id).join('|');

  return (
    <div ref={ref} className="bento" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {/* A card that leaves fades where it stood while the others glide to their new places. */}
      <AnimatePresence mode="popLayout" initial={false}>
        {books.map((book, i) => {
          const [col, row, spanC, spanR, v] = slots[i];
          const place = { gridColumn: `${col + 1} / span ${spanC}`, gridRow: `${row + 1} / span ${spanR}` };
          return (
            <Tile
              key={book.id}
              book={book}
              variant={v}
              index={i}
              enter={enter}
              now={now}
              art={i < 2}
              radius={v === 'small' ? 20 : 26}
              style={place}
              layoutKey={layoutKey}
              onOpen={onOpen}
            />
          );
        })}
      </AnimatePresence>
    </div>
  );
}
