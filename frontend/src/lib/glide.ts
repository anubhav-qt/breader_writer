/*
 * Scrolling a scroller from code, gently: a page turned with a key, or the page following a voice
 * or Immersive's light. Not the browser's own smooth scrolling: on an iPhone, a finger landing
 * during one could leave the page stuck, taking no swipes at all until a chapter change or a
 * reload. This one moves the page a frame at a time, and lets go the moment the reader touches it,
 * turns a wheel or presses a key.
 */

const gliding = new WeakMap<HTMLElement, () => void>();
const HANDS = ['wheel', 'touchstart', 'pointerdown'] as const;
const OPTS = { passive: true, capture: true } as const;

/** Stops a glide where it is: the page is being put somewhere else. */
export const stopGlide = (el: HTMLElement) => gliding.get(el)?.();

/** Scrolls `el` down by `by` pixels (up when negative). `onEnd` runs once it's there, or the reader took over. */
export function glide(el: HTMLElement, by: number, onEnd?: () => void, ms = 380) {
  stopGlide(el);
  const from = el.scrollTop;
  const to = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, from + by));
  if (Math.abs(to - from) < 1 || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.scrollTop = to;
    onEnd?.();
    return;
  }
  const t0 = performance.now();
  let raf = 0;
  const end = () => {
    cancelAnimationFrame(raf);
    for (const k of HANDS) el.removeEventListener(k, end, OPTS);
    window.removeEventListener('keydown', end, OPTS);
    if (gliding.get(el) === end) gliding.delete(el);
    onEnd?.();
  };
  const frame = (now: number) => {
    const p = Math.min(1, Math.max(0, (now - t0) / ms));
    el.scrollTop = from + (to - from) * (1 - (1 - p) ** 3);
    if (p < 1) raf = requestAnimationFrame(frame);
    else end();
  };
  for (const k of HANDS) el.addEventListener(k, end, OPTS);
  window.addEventListener('keydown', end, OPTS);
  gliding.set(el, end);
  raf = requestAnimationFrame(frame);
}
