/*
 * Page and chapter transitions that swap one page for the next (fade, wipe, depth, sheet). They
 * use view transitions: the browser snapshots the old page, we move to the new one, and CSS in
 * concepts.css animates between the two pictures. Springs become CSS linear() curves so these
 * match the motion springs.
 */

export type TurnStyle = 'today' | 'slide' | 'fade' | 'wipe' | 'depth' | 'sheet';
export type TurnKind = 'page' | 'chapter';

/** A spring (response in seconds, damping ratio) sampled into a CSS linear() easing. */
function springCurve(response: number, damping: number) {
  const w = (2 * Math.PI) / response;
  const x = (t: number) => {
    if (damping >= 1) return 1 - (1 + w * t) * Math.exp(-w * t);
    const wd = w * Math.sqrt(1 - damping * damping);
    return 1 - Math.exp(-damping * w * t) * (Math.cos(wd * t) + ((damping * w) / wd) * Math.sin(wd * t));
  };
  // It has settled once it stays within half a percent of the end.
  let settle = 0;
  for (let t = 0; t < 3; t += 1 / 240) if (Math.abs(1 - x(t)) > 0.005) settle = t;
  const T = settle + 1 / 60;
  const n = 48;
  const stops = Array.from({ length: n + 1 }, (_, i) => (i === n ? 1 : +x((i / n) * T).toFixed(4)));
  return { easing: `linear(${stops.join(', ')})`, ms: Math.round(T * 1000) };
}

export const curves = {
  smooth: springCurve(0.5, 1),
  snappy: springCurve(0.32, 0.86),
  soft: springCurve(0.75, 1),
};

if (typeof document !== 'undefined') {
  const s = document.documentElement.style;
  for (const [name, c] of Object.entries(curves)) {
    s.setProperty(`--ease-${name}`, c.easing);
    s.setProperty(`--dur-${name}`, `${c.ms}ms`);
  }
}

/** Styles that swap snapshots. Today's and the Rail's slide move the strip of pages instead. */
export const swaps = (style: TurnStyle) => style !== 'today' && style !== 'slide';

type VT = { ready: Promise<void>; finished: Promise<void>; skipTransition: () => void };
type DocVT = Document & { startViewTransition?: (update: () => void | Promise<void>) => VT };

let running: VT | null = null;

const WIPE = ['--wipe-l', '--wipe-r', '--wipe-lr', '--wipe-rr'];

/**
 * Runs `update` (which must leave the DOM showing the new page) inside a view transition.
 * A new turn skips whatever is still moving, so turning quickly never waits.
 *
 * The whole screen is snapshotted and wiped, with the page's edges (`page`) as the wipe's start
 * and end; the margins around it are plain page colour. Snapshotting the page on its own looked
 * the same, but Safari captures its strip of columns, moved sideways to the current page, as
 * blank, so on iPhones every turn flashed an empty page.
 */
export function runTurn(style: TurnStyle, dir: 1 | -1, kind: TurnKind, update: () => void | Promise<void>, page?: DOMRect) {
  const doc = document as DocVT;
  if (!swaps(style) || !doc.startViewTransition) {
    void update();
    return;
  }
  const root = document.documentElement;
  running?.skipTransition();
  root.dataset.turn = style;
  root.dataset.dir = dir > 0 ? 'next' : 'prev';
  root.dataset.kind = kind;
  const l = page ? Math.max(0, page.left) : 0;
  const r = page ? Math.min(window.innerWidth, page.right) : window.innerWidth;
  const w = window.innerWidth;
  [l, r, w - l, w - r].forEach((v, i) => root.style.setProperty(WIPE[i], `${Math.round(v)}px`));
  const t = doc.startViewTransition(update);
  running = t;
  // The browser aborts a turn when the window resizes mid-way (a phone rotating); that's fine.
  t.ready.catch(() => {});
  t.finished.catch(() => {}).finally(() => {
    if (running !== t) return;
    running = null;
    delete root.dataset.turn;
    delete root.dataset.dir;
    delete root.dataset.kind;
    WIPE.forEach((k) => root.style.removeProperty(k));
  });
}
