import { useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ShelfItem } from '../../data/useLibrary';
import { Modal } from '../../components/Modal';
import { cardAuthor } from './names';
import { finishedIn, numberOf, type Series } from './series';
import { Tile } from './Tile';
import { TitleHint } from './TitleHint';

interface Props {
  series: Series;
  /** The name its cards go by, by book id. */
  authors: Map<string, string>;
  now: number;
  editingId?: string;
  onOpen: (book: ShelfItem, rect: DOMRect) => void;
  onEdit: (book: ShelfItem, anchor: HTMLElement) => void;
  onClose: () => void;
}

/** A whole series, its books in order on cards all the same size. Opening one closes it. */
export function SeriesDialog({ series: s, authors, now, editingId, onOpen, onEdit, onClose }: Props) {
  const grid = useRef<HTMLDivElement>(null);
  const author = s.books.map((b) => authors.get(b.id)).find(Boolean) ?? cardAuthor(s.books[0].author).author;
  const n = s.books.length;
  const finished = finishedIn(s);
  return createPortal(
    <Modal title={s.name} onClose={onClose} width={880} className="sd">
      <p className="sd-meta">
        {author && <span>{author}</span>}
        <span>{n === 1 ? '1 book' : `${n} books`}</span>
        <span>{finished === n ? 'All finished' : `${finished} finished`}</span>
      </p>
      <div ref={grid} className="sd-grid">
        {s.books.map((b, k) => {
          const key = b.key ?? b.id;
          return (
            <Tile
              key={key}
              item={{ key, book: b, author: authors.get(b.id) }}
              variant="cover"
              index={k}
              enter={false}
              now={now}
              radius="8px 18px 18px 8px"
              className="sd-tile"
              number={numberOf(s, b)}
              open={key === editingId}
              onOpen={(book, rect) => { onClose(); onOpen(book, rect); }}
              onEdit={onEdit}
            />
          );
        })}
      </div>
      <TitleHint root={grid} />
    </Modal>,
    document.body,
  );
}
