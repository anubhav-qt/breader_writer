import { AnimatePresence } from 'motion/react';
import { useElementWidth } from '../useElementWidth';
import { Tile } from '../Tile';
import type { SectionProps } from '../types';
import { slotsFor } from './slots';

export function Bento({ items, now, enter, editingId, onOpen, onEdit }: SectionProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const cols = width >= 1000 ? 6 : width >= 640 ? 4 : 2;
  const slots = slotsFor(items.length, cols);
  const layoutKey = items.map((it) => it.key).join('|');

  return (
    <div ref={ref} className="bento" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {/* A removed card fades where it stood while the others glide to their new places. */}
      <AnimatePresence mode="popLayout" initial={false}>
        {items.map((item, i) => {
          const [col, row, spanC, spanR, v] = slots[i];
          const place = { gridColumn: `${col + 1} / span ${spanC}`, gridRow: `${row + 1} / span ${spanR}` };
          return (
            <Tile
              key={item.key}
              item={item}
              variant={v}
              index={i}
              enter={enter}
              now={now}
              art={i < 2}
              radius={v === 'small' ? 20 : 26}
              style={place}
              open={(item.book.key ?? item.book.id) === editingId}
              layoutKey={layoutKey}
              onOpen={onOpen}
              onEdit={onEdit}
            />
          );
        })}
      </AnimatePresence>
    </div>
  );
}
