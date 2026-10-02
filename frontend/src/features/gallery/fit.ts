/*
 * Fitting a card's text to its card. A title first shrinks until its longest word fits on a line,
 * so words never break. It gets the lines its card has room for, never more than its style
 * allows, then shrinks a little more to fit all of it; a subtitle or the reading line under it
 * takes the lines left, or goes. Whatever still doesn't fit is cut
 * at a word with an ellipsis, in the text itself: a line clamp alone leaves the next line laid out
 * under the last, and the reading face's tall letters reach up past the clip. Every element that
 * is cut this way carries its full text in data-full; the text node React made is edited in
 * place, so React's own updates still land.
 */

/** Titles shrink this far below their set size to fit whole, before they're cut. */
const TITLE_FLOOR = 0.8;
/** The elements cut with an ellipsis, and the titles among them, which shrink first. */
const CUT = '.t-title, .t-line, .c-sub, .mc-title';

/**
 * Whether `el`'s text runs to more lines than it shows, or past its side (a last word with its
 * ellipsis can be wider than a narrow card). Its scroll height can't tell: the reading face's
 * letters hang below their line box, so even one word seems to overflow. So the lines the text is
 * laid out on are counted instead, clamped ones included, and its side is measured to the fraction
 * of a pixel, which its scroll width rounds away.
 */
function over(el: HTMLElement): boolean {
  const cs = getComputedStyle(el);
  const range = document.createRange();
  range.selectNodeContents(el);
  const boxes = Array.from(range.getClientRects());
  const side = el.getBoundingClientRect().right - parseFloat(cs.paddingRight);
  if (boxes.some((r) => r.right > side + 0.5)) return true;
  const lh = parseFloat(cs.lineHeight);
  if (!lh) return el.scrollHeight > el.clientHeight + 1;
  const shown = Math.round((el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / lh);
  const tops = boxes.map((r) => r.top).sort((a, b) => a - b);
  let lines = 0;
  let last = -Infinity;
  for (const top of tops) {
    if (top - last <= lh / 2) continue;
    lines++;
    last = top;
  }
  return lines > shown;
}

function textNode(el: HTMLElement): Text | null {
  const t = el.firstChild;
  return t && t.nodeType === Node.TEXT_NODE ? (t as Text) : null;
}

/** Cuts `el`'s text at the last word that leaves room for an ellipsis. Returns what it shows. */
function cut(el: HTMLElement, full: string): string {
  const node = textNode(el);
  if (!node) return full;
  node.nodeValue = full;
  if (!over(el)) return full;
  const words = full.split(/\s+/);
  // One word has nothing to cut: an ellipsis after it only makes it wider.
  if (words.length < 2) return full;
  const at = (k: number) => `${words.slice(0, k).join(' ').replace(/[\s,;:.\-\u2013\u2014]+$/, '')}…`;
  let lo = 1;
  let hi = words.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    node.nodeValue = at(mid);
    if (over(el)) hi = mid - 1;
    else lo = mid;
  }
  node.nodeValue = at(lo);
  return node.nodeValue;
}

/** An element's height where it stands, margins included, or 0 when it isn't shown. Untransformed, so a card mid-animation measures true. */
function outer(el: Element): number {
  if (!(el instanceof HTMLElement) || !el.offsetParent) return 0;
  const cs = getComputedStyle(el);
  return el.offsetHeight + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
}

/** The lines the style allows `el`. */
const clampOf = (cs: CSSStyleDeclaration) => parseInt(cs.getPropertyValue('-webkit-line-clamp')) || 1;

/** The height `box` holds inside its padding. */
function inside(box: HTMLElement): number {
  const cs = getComputedStyle(box);
  return box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
}

/**
 * The lines a title has room for: as many as its style allows, fewer when the card is too short
 * for them beside everything else it shows. Under a card's mark the title has the space left
 * (its subtitle gives way); beside a cover, whatever the other lines leave (the reading line gives
 * way). Rounding is forgiven by a pixel.
 */
function titleLines(t: HTMLElement): number {
  const cs = getComputedStyle(t);
  const box = t.parentElement!;
  let room = inside(box);
  if (!box.classList.contains('c-name')) {
    for (const c of box.children) if (c !== t && !c.classList.contains('t-line')) room -= outer(c);
  }
  return Math.max(1, Math.min(clampOf(cs), Math.floor((room + 1) / parseFloat(cs.lineHeight))));
}

/**
 * The subtitle under a title, or the line where the reader stopped: the lines left once the rest
 * of the card is set, or none, and then it goes. Returns how many.
 */
function underLines(el: HTMLElement): number {
  const cs = getComputedStyle(el);
  const box = el.parentElement!;
  // The reading line's top margin is the card's free space, so it isn't counted.
  let room = inside(box) - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - (el.classList.contains('t-line') ? 0 : parseFloat(cs.marginTop));
  for (const c of box.children) if (c !== el) room -= outer(c);
  return Math.min(clampOf(cs), Math.floor((room + 1) / parseFloat(cs.lineHeight)));
}

/**
 * Sets titles to the lines they have room for, having shrunk them until the longest word fits,
 * then shrinks them toward TITLE_FLOOR until all of the title does.
 */
function fitTitles(titles: HTMLElement[]) {
  const t = titles[0];
  const set = (px: number) => titles.forEach((el) => el.style.setProperty('font-size', `${Math.floor(px * 10) / 10}px`));
  const base = parseFloat(getComputedStyle(t).fontSize);
  // Measured to the fraction of a pixel, as over() measures: client and scroll widths round, and a
  // title half a pixel wider than its card fits by them.
  for (let i = 0; i < 3; i++) {
    const cs = getComputedStyle(t);
    const box = t.getBoundingClientRect();
    const left = box.left + parseFloat(cs.paddingLeft);
    const room = box.right - parseFloat(cs.paddingRight) - left;
    const range = document.createRange();
    range.selectNodeContents(t);
    const need = Math.max(left, ...Array.from(range.getClientRects(), (r) => r.right)) - left;
    if (need <= room + 0.5 || room <= 0) break;
    set(parseFloat(cs.fontSize) * (room / need));
  }
  const lines = String(titleLines(t));
  titles.forEach((el) => el.style.setProperty('-webkit-line-clamp', lines));
  for (let i = 0; i < 4 && over(t); i++) {
    const size = parseFloat(getComputedStyle(t).fontSize);
    if (size <= base * TITLE_FLOOR + 0.5) break;
    set(Math.max(base * TITLE_FLOOR, size * 0.94));
  }
}

/**
 * Fits the text of a card: `faces` are its page face and its ink face, which hold the same text
 * and must be set the same.
 */
export function fitCard(tile: HTMLElement | null) {
  if (!tile) return;
  const faces = Array.from(tile.querySelectorAll<HTMLElement>(':scope > .tile-face, :scope > .tile-art'));
  const all = faces.flatMap((f) => Array.from(f.querySelectorAll<HTMLElement>(CUT)));
  // Back to the whole text at the set size, on the lines the style allows, then fit again.
  for (const el of all) {
    const node = textNode(el);
    if (node && el.dataset.full != null) node.nodeValue = el.dataset.full;
    for (const p of ['font-size', '-webkit-line-clamp', 'display']) el.style.removeProperty(p);
  }
  const titles = all.filter((el) => el.classList.contains('t-title') && el.offsetParent);
  if (titles.length) fitTitles(titles);
  // What sits under the title takes the lines left, measured on the first face that shows it.
  const under = new Map<string, number>();
  for (const el of all) {
    if (!el.classList.contains('t-line') && !el.classList.contains('c-sub')) continue;
    if (!under.has(el.className) && el.offsetParent) under.set(el.className, underLines(el));
    const lines = under.get(el.className);
    if (lines === undefined) continue;
    if (lines < 1) el.style.setProperty('display', 'none');
    else el.style.setProperty('-webkit-line-clamp', String(lines));
  }
  // Each distinct piece of text is fitted once, on the first face that shows it; the others copy it.
  const done = new Map<string, string>();
  for (const el of all) {
    const full = el.dataset.full;
    if (full == null || !el.offsetParent) continue;
    const key = `${el.className}|${full}`;
    const shown = done.get(key) ?? cut(el, full);
    done.set(key, shown);
    const node = textNode(el);
    if (node && node.nodeValue !== shown) node.nodeValue = shown;
  }
}

/** Whether a card's text was cut short: its full text differs from what it shows. */
export const isCut = (el: HTMLElement) => el.dataset.full != null && el.textContent !== el.dataset.full;
