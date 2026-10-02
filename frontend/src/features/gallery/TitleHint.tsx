import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { springs } from '../../lib/springs';
import { isCut } from './fit';

/** How long the pointer must rest before the full title appears. */
const REST_MS = 500;
const OFFSET_X = 12;
const OFFSET_Y = 22;
const MARGIN = 12;

interface Hint { id: number; text: string; x: number; y: number }

/**
 * The full name of a shortened card title. It appears beside the pointer once the pointer has
 * rested on the title for half a second, and goes the moment the pointer moves again.
 */
export function TitleHint({ root }: { root: RefObject<HTMLElement | null> }) {
  const [hint, setHint] = useState<Hint | null>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let timer = 0;
    let x = -1;
    let y = -1;
    let n = 0;

    const hide = () => {
      window.clearTimeout(timer);
      setHint(null);
    };
    const show = () => {
      const hit = document.elementFromPoint(x, y);
      if (!hit || !el.contains(hit) || hit.closest('.tile-tools')) return;
      // Titles don't take the pointer (the card's button does), so find the one under it.
      const title = hit.closest('.tile')?.querySelector<HTMLElement>('.tile-face:not(.is-ink) .t-title');
      if (!title || !isCut(title)) return;
      const r = title.getBoundingClientRect();
      const top = r.top + parseFloat(getComputedStyle(title).paddingTop);
      if (x < r.left || x > r.right || y < top || y > r.bottom) return;
      setHint({ id: ++n, text: title.dataset.full ?? title.textContent ?? '', x, y });
    };
    const rest = () => {
      hide();
      if (x >= 0) timer = window.setTimeout(show, REST_MS);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || (e.clientX === x && e.clientY === y)) return;
      x = e.clientX;
      y = e.clientY;
      rest();
    };
    const onLeave = () => {
      x = -1;
      hide();
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointerdown', hide);
    // Scrolling moves the titles under a still pointer: start the wait again.
    el.addEventListener('scroll', rest, { passive: true });
    window.addEventListener('blur', onLeave);
    return () => {
      window.clearTimeout(timer);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointerdown', hide);
      el.removeEventListener('scroll', rest);
      window.removeEventListener('blur', onLeave);
    };
  }, [root]);

  return createPortal(
    <AnimatePresence>{hint && <HintBox key={hint.id} hint={hint} />}</AnimatePresence>,
    document.body,
  );
}

function HintBox({ hint }: { hint: Hint }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; origin: string } | null>(null);

  // Below and right of the pointer, flipped when that would leave the window.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const flipX = hint.x + OFFSET_X + w > window.innerWidth - MARGIN;
    const flipY = hint.y + OFFSET_Y + h > window.innerHeight - MARGIN;
    setPos({
      left: flipX ? Math.max(MARGIN, hint.x - OFFSET_X - w) : hint.x + OFFSET_X,
      top: flipY ? Math.max(MARGIN, hint.y - 10 - h) : hint.y + OFFSET_Y,
      origin: `${flipY ? 'bottom' : 'top'} ${flipX ? 'right' : 'left'}`,
    });
  }, [hint]);

  return (
    <motion.div
      ref={ref}
      className="title-hint"
      role="tooltip"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? 0, transformOrigin: pos?.origin }}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={pos ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.96 }}
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
      transition={springs.snappy}
    >
      {hint.text}
    </motion.div>
  );
}
