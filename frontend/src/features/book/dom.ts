/*
 * Position helpers, breader's (features/reader/dom.ts), without what reading aloud and pictures
 * needed. A position is (block, character offset): stable across any reflow, unlike a
 * page number. These map between positions and what's on screen.
 */

const BLOCKS = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, figure, table, dt, dd, hr, div';
const INNER = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, figure, table, dt, dd, div';

/** Leaf-level block elements in reading order. */
export function collectBlocks(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(BLOCKS)).filter((el) => !el.querySelector(INNER));
}

function textNodes(el: HTMLElement): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

function rectAt(nodes: Text[], index: number): DOMRect | null {
  let i = index;
  for (const node of nodes) {
    const len = node.data.length;
    if (i < len) {
      const range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const r = range.getClientRects()[0];
      return r && (r.width || r.height) ? r : null;
    }
    i -= len;
  }
  return null;
}

export function firstRect(el: HTMLElement): DOMRect | null {
  for (const r of Array.from(el.getClientRects())) if (r.width || r.height) return r;
  return null;
}

export function charRect(el: HTMLElement, offset: number): DOMRect | null {
  if (offset <= 0) return firstRect(el);
  const nodes = textNodes(el);
  for (let i = offset; i < offset + 40; i++) {
    const r = rectAt(nodes, i);
    if (r) return r;
  }
  return firstRect(el);
}

/** The first character in the block for which `pred` holds, by binary search (characters flow in order). */
export function firstCharWhere(el: HTMLElement, pred: (r: DOMRect) => boolean): number {
  const nodes = textNodes(el);
  const total = nodes.reduce((n, t) => n + t.data.length, 0);
  let lo = 0;
  let hi = total - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = rectAt(nodes, mid);
    if (r && pred(r)) {
      ans = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return ans;
}

/** The sentence around a character offset, for the library card's "where you stopped" line. */
export function sentenceAt(text: string, offset: number): string {
  const re = /[.!?…]["”’)\]]*\s+/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && m.index + m[0].length <= offset) start = m.index + m[0].length;
  re.lastIndex = Math.max(offset, start);
  const e = re.exec(text);
  const end = e ? e.index + e[0].length : text.length;
  const s = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return s.length > 280 ? `${s.slice(0, 277)}…` : s;
}
