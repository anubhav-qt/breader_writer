import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { animate, motion, useMotionValue } from 'motion/react';
import type { ShelfItem } from '../../data/useLibrary';
import { springs } from '../../lib/springs';
import { IconMore, IconStar } from '../../components/icons';
import { blotsFor, maskFor, radiiFor } from './blots';
import { fitCard } from './fit';
import { cardNames } from './names';
import { actionLabel, progressText, shortProgress, timeLeft, when } from './text';
import type { GalleryItem } from './types';
import { useSize } from './useSize';
import { bookVars } from './vars';

export type Variant = 'hero' | 'square' | 'wide' | 'tall' | 'small' | 'cover';

export interface TileProps {
  item: GalleryItem;
  variant: Variant;
  index: number;
  enter: boolean;
  now: number;
  /** Show the book's cover, when it has one and the card has room. Only the two most recent do. */
  art?: boolean;
  className?: string;
  style?: CSSProperties;
  radius?: string | number;
  /** Its edit popover is open. */
  open?: boolean;
  /** Changes when books join or leave the section: only then do cards glide to their new places. */
  layoutKey?: string;
  /** The book's number in its series, on a card in a series row. */
  number?: number;
  /** A whole series as one card, standing on the book that's next in it. */
  stack?: Stack;
  ref?: Ref<HTMLDivElement>;
  onOpen: (book: ShelfItem, rect: DOMRect) => void;
  onEdit: (book: ShelfItem, anchor: HTMLElement) => void;
}

export interface Stack {
  name: string;
  count: number;
  finished: number;
}

function setMask(el: HTMLElement | null, mask: string) {
  if (!el) return;
  el.style.setProperty('-webkit-mask-image', mask);
  el.style.setProperty('mask-image', mask);
}

/**
 * One book card. It starts in the page's own colour with a contrasting border; the book's colour
 * fills it in patches as it is read. The same content is drawn twice: once in page colours, once
 * in the book's colour and ink, masked to the patches, so text stays legible over both.
 *
 * A full-size button opens the book; the corner button (or a right-click) opens the edit popover.
 */
export function Tile({ item, variant, index, enter, now, art = false, className = '', style, radius = 22, open = false, layoutKey, number, stack, ref: slotRef, onOpen, onEdit }: TileProps) {
  const b = item.book;
  const [ref, size] = useSize<HTMLDivElement>();
  const inkRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const progress = b.progress >= 1 ? 1 : b.progress;
  const blots = useMemo(() => blotsFor(b.id), [b.id]);
  // The colour shown: a new amount (a book marked finished) grows in rather than jumping there.
  const fill = useMotionValue(progress);
  useEffect(() => {
    if (fill.get() === progress) return;
    const run = animate(fill, progress, springs.smooth);
    return () => run.stop();
  }, [fill, progress]);
  const sized = useRef({ p: -1, w: 0, h: 0, radii: [] as number[] });
  const radiiAt = (p: number) => {
    const c = sized.current;
    if (c.p !== p || c.w !== size.w || c.h !== size.h) sized.current = { p, w: size.w, h: size.h, radii: radiiFor(blots, p, size.w, size.h) };
    return sized.current.radii;
  };
  // The cover keeps its own proportions, so it is never cropped.
  const [artRatio, setArtRatio] = useState(2 / 3);

  // Blots grow in from nothing when the library first appears.
  const grow = useMotionValue(enter ? 0 : 1);
  useEffect(() => {
    if (!enter) return;
    const run = animate(grow, 1, { ...springs.smooth, delay: 0.3 + Math.min(index, 24) * 0.03 });
    return () => run.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const apply = (k = grow.get()) => {
    const p = fill.get();
    setMask(inkRef.current, p >= 1 && k > 0.995 ? 'none' : maskFor(blots, radiiAt(p), k));
  };
  useEffect(() => grow.on('change', apply));
  useEffect(() => fill.on('change', () => apply()));
  useLayoutEffect(() => { apply(grow.get()); });

  const roomy = variant === 'hero' || variant === 'square';
  const hasArt = art && !!b.coverUrl && roomy;
  // A recent book without a cover gets one drawn.
  const made = art && !b.coverUrl && roomy;
  const started = b.progress > 0;
  useLayoutEffect(() => fitCard(ref.current), [ref, size.w, size.h, b.title, b.line, b.author, item.author, stack?.name, variant, hasArt, artRatio, started]);
  useEffect(() => {
    let live = true;
    void document.fonts.ready.then(() => { if (live) fitCard(ref.current); });
    return () => { live = false; };
  }, [ref]);
  const face = <Face book={b} variant={variant} now={now} number={number} author={item.author} stack={stack} beside={hasArt || made} />;

  return (
    <motion.div
      ref={slotRef}
      className={`tile-slot ${className}${stack ? ' is-stack' : ''}`}
      style={{ ...style, borderRadius: radius }}
      // The library's first appearance rises in; a book added or put back later settles in place.
      initial={enter ? { opacity: 0, y: 18 } : { opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.2 } }}
      transition={{ ...springs.smooth, delay: enter ? Math.min(index, 24) * 0.028 : 0 }}
      layout="position"
      layoutDependency={layoutKey}
    >
      <div
        ref={ref}
        className={`tile tile-${variant}${hasArt || made ? ' has-art' : ''}`}
        style={{ ...bookVars(b), ...(hasArt ? { '--art-ratio': artRatio } : null) } as CSSProperties}
        onContextMenu={(e) => {
          if (!moreRef.current) return;
          e.preventDefault();
          if (!open) onEdit(b, moreRef.current);
        }}
      >
        <div className="tile-face">{face}</div>
        {started && <div ref={inkRef} className="tile-face is-ink" aria-hidden="true">{face}</div>}
        <button
          type="button"
          className="tile-hit"
          data-id={b.id}
          aria-label={stack ? `${stack.name}, a series of ${stack.count} books, ${stack.finished} finished` : `${b.title}, ${progressText(b)}`}
          aria-haspopup={stack ? 'dialog' : undefined}
          onClick={(e) => onOpen(b, (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect())}
        />
        {made && <MadeCover book={b} number={number} author={item.author} />}
        {hasArt && (
          <span className="tile-art">
            <img
              src={b.coverUrl}
              alt=""
              draggable={false}
              onLoad={(e) => {
                const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
                if (w && h) setArtRatio(w / h);
              }}
            />
          </span>
        )}
        {/* A series' card opens the series; its books are edited there. */}
        {!stack && <div className="tile-tools">
          {b.favorite && <span className="tile-fav" title="Favourite"><IconStar /></span>}
          <button
            ref={moreRef}
            type="button"
            className="tile-more"
            aria-label={`Edit ${b.title}`}
            aria-haspopup="dialog"
            aria-expanded={open}
            title="Edit"
            onClick={(e) => onEdit(b, e.currentTarget)}
          >
            <IconMore />
          </button>
        </div>}
      </div>
    </motion.div>
  );
}

const join = (...parts: Array<string | false | undefined | 0>) => parts.filter(Boolean).join(' · ');

/** A cover's big dotted mark: the volume's number, or the title's first letter past "The". */
function markFor(title: string, vol?: number) {
  if (vol) return String(vol).padStart(2, '0');
  const word = title.replace(/^(the|a|an|le|la|les|el|der|die|das)\s+/i, '');
  return (word.match(/[\p{L}\p{N}]/u)?.[0] ?? '·').toUpperCase();
}

/**
 * Each card is set like a cover: the author, a big dotted mark (the volume's number, or the title's
 * first letter), the title, and how far. Names are tidied from what the file says (names.ts). Beside
 * a cover, real or drawn, the text is a column that ends on the line where the reader stopped (the
 * opening line for a new book); CSS hides it on cards too narrow or short for it.
 */
function Face({ book: b, variant, now, number, author, stack, beside }: { book: ShelfItem; variant: Variant; now: number; number?: number; author?: string; stack?: Stack; beside: boolean }): ReactNode {
  const n = cardNames(b, author);
  // A card in a series row goes by its number there.
  const vol = number ?? n.vol;
  if (stack) {
    const read = stack.finished === stack.count ? 'Finished' : stack.finished ? `${stack.finished} of ${stack.count} read` : `${stack.count} books`;
    return (
      <>
        <span className="c-by">{n.author || '\u00a0'}</span>
        <span className="c-mark" aria-hidden="true">{markFor(stack.name, vol)}</span>
        <span className="c-name"><span className="t-title" data-full={stack.name}>{stack.name}</span></span>
        <span className="c-foot">
          <span>{read}</span>
          {vol ? <span>Vol. {vol}</span> : null}
        </span>
      </>
    );
  }
  if (beside) {
    return (
      <>
        <span className="t-eyebrow">{join(vol && `Vol. ${vol}`, when(b, now))}</span>
        <span className="t-title" data-full={n.title}>{n.title}</span>
        {n.sub && <span className="t-subtitle">{n.sub}</span>}
        {n.author && <span className="t-author">{n.author}</span>}
        {b.line && <span className="t-line" data-full={b.line}>{b.line}</span>}
        <span className="t-foot">
          <span className="t-meta">{variant === 'hero' ? progressText(b) : timeLeft(b)}</span>
          {variant === 'hero' && <span className="t-cta">{actionLabel(b)} ›</span>}
        </span>
      </>
    );
  }
  return (
    <>
      <span className="c-by">{n.author || '\u00a0'}</span>
      <span className="c-mark" aria-hidden="true">{markFor(n.title, vol)}</span>
      <span className="c-name">
        <span className="t-title" data-full={n.title}>{n.title}</span>
        {n.sub && <span className="c-sub" data-full={n.sub}>{n.sub}</span>}
      </span>
      <span className="c-foot">
        {variant === 'square' || variant === 'wide' ? (
          <span><span className="c-long">{timeLeft(b)}</span><span className="c-short">{shortProgress(b)}</span></span>
        ) : (
          <span>{shortProgress(b)}</span>
        )}
        {vol ? <span>Vol. {vol}</span> : null}
      </span>
    </>
  );
}

/** The cover drawn for a recent book without one: its colour, its author, its mark and its title. */
function MadeCover({ book: b, number, author }: { book: ShelfItem; number?: number; author?: string }) {
  const n = cardNames(b, author);
  return (
    <span className="tile-art is-made" aria-hidden="true">
      <span className="mc-by">{n.author}</span>
      <span className="mc-mark">{markFor(n.title, number ?? n.vol)}</span>
      <span className="mc-title" data-full={n.title}>{n.title}</span>
    </span>
  );
}
