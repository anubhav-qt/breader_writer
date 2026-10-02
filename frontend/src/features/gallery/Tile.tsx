import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties, type MouseEvent, type ReactNode, type Ref } from 'react';
import { animate, motion, useMotionValue } from 'motion/react';
import { lengthName, written, type Book } from '../../data/books';
import { springs } from '../../lib/springs';
import { blotsFor, maskFor, radiiFor } from './blots';
import { fitCard } from './fit';
import { actionLabel, progressText, shortProgress, when, wordsLeft } from './text';
import { useSize } from './useSize';
import { bookVars } from './vars';

export type Variant = 'hero' | 'square' | 'wide' | 'tall' | 'small' | 'cover';

export interface TileProps {
  book: Book;
  variant: Variant;
  index: number;
  enter: boolean;
  now: number;
  /** Draw the book a cover, when the card has room. Only the two most recent do. */
  art?: boolean;
  className?: string;
  style?: CSSProperties;
  radius?: string | number;
  /** Changes when books join or leave the section: only then do cards glide to their new places. */
  layoutKey?: string;
  ref?: Ref<HTMLDivElement>;
  onOpen: (book: Book, rect: DOMRect) => void;
}

function setMask(el: HTMLElement | null, mask: string) {
  if (!el) return;
  el.style.setProperty('-webkit-mask-image', mask);
  el.style.setProperty('mask-image', mask);
}

/**
 * One book card. It starts in the page's own colour with a contrasting border; the book's colour
 * fills it in patches as the book is written. The same content is drawn twice: once in page
 * colours, once in the book's colour and ink, masked to the patches, so text stays legible over
 * both. A full-size button opens the book.
 */
export function Tile({ book: b, variant, index, enter, now, art = false, className = '', style, radius = 22, layoutKey, ref: slotRef, onOpen }: TileProps) {
  const [ref, size] = useSize<HTMLDivElement>();
  const inkRef = useRef<HTMLDivElement>(null);
  const progress = written(b);
  const blots = useMemo(() => blotsFor(b.id), [b.id]);
  // The colour shown: a new amount grows in rather than jumping there.
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
  const made = art && roomy;
  const started = progress > 0;
  useLayoutEffect(() => fitCard(ref.current), [ref, size.w, size.h, b.title, b.wordGoal, variant, made, started]);
  useEffect(() => {
    let live = true;
    void document.fonts.ready.then(() => { if (live) fitCard(ref.current); });
    return () => { live = false; };
  }, [ref]);
  const face = <Face book={b} variant={variant} now={now} beside={made} />;

  const open = (e: MouseEvent<HTMLButtonElement>) => {
    const card = e.currentTarget.parentElement as HTMLElement;
    onOpen(b, card.getBoundingClientRect());
  };

  return (
    <motion.div
      ref={slotRef}
      className={`tile-slot ${className}`}
      style={{ ...style, borderRadius: radius }}
      // The library's first appearance rises in; a book added later settles in place.
      initial={enter ? { opacity: 0, y: 18 } : { opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.2 } }}
      transition={{ ...springs.smooth, delay: enter ? Math.min(index, 24) * 0.028 : 0 }}
      layout="position"
      layoutDependency={layoutKey}
    >
      <div ref={ref} className={`tile tile-${variant}${made ? ' has-art' : ''}`} style={bookVars(b)}>
        <div className="tile-face">{face}</div>
        {started && <div ref={inkRef} className="tile-face is-ink" aria-hidden="true">{face}</div>}
        <button type="button" className="tile-hit" data-id={b.id} aria-label={`${b.title}, ${progressText(b)}`} onClick={open} />
        {made && <MadeCover book={b} />}
      </div>
    </motion.div>
  );
}

/** A card's big dotted mark: the title's first letter, past "The". */
function markFor(title: string) {
  const word = title.replace(/^(the|a|an|le|la|les|el|der|die|das)\s+/i, '');
  const letter = word.match(/[\p{L}\p{N}]/u);
  if (letter) return letter[0].toUpperCase();
  return '·';
}

/**
 * Each card is set like a cover: the book's length, a big dotted mark (the title's first letter),
 * the title, and how much is written. Beside a drawn cover, the text is a column instead.
 */
function Face({ book: b, variant, now, beside }: { book: Book; variant: Variant; now: number; beside: boolean }): ReactNode {
  const length = lengthName(b);
  if (beside) {
    return (
      <>
        <span className="t-eyebrow">{when(b, now)}</span>
        <span className="t-title" data-full={b.title}>{b.title}</span>
        <span className="t-author">{length}</span>
        <span className="t-foot">
          <span className="t-meta">{variant === 'hero' ? progressText(b) : wordsLeft(b)}</span>
          {variant === 'hero' && <span className="t-cta">{actionLabel(b)} ›</span>}
        </span>
      </>
    );
  }

  let foot = <span>{shortProgress(b)}</span>;
  if (variant === 'square' || variant === 'wide') {
    foot = <span><span className="c-long">{wordsLeft(b)}</span><span className="c-short">{shortProgress(b)}</span></span>;
  }
  return (
    <>
      <span className="c-by">{length}</span>
      <span className="c-mark" aria-hidden="true">{markFor(b.title)}</span>
      <span className="c-name">
        <span className="t-title" data-full={b.title}>{b.title}</span>
      </span>
      <span className="c-foot">{foot}</span>
    </>
  );
}

/** The cover drawn for a recent book: its colour, its length, its mark and its title. */
function MadeCover({ book: b }: { book: Book }) {
  return (
    <span className="tile-art is-made" aria-hidden="true">
      <span className="mc-by">{lengthName(b)}</span>
      <span className="mc-mark">{markFor(b.title)}</span>
      <span className="mc-title" data-full={b.title}>{b.title}</span>
    </span>
  );
}
