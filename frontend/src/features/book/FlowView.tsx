import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { animate } from 'motion';
import type { FlowBook, Position } from './types';
import { countWords } from '../../lib/format';
import { glide, stopGlide } from '../../lib/glide';
import { charRect, collectBlocks, firstCharWhere, firstRect, sentenceAt } from './dom';
import { fontFamily, type Style, type StyleSettings } from './settings';
import { runTurn, swaps, type TurnStyle } from './turn';

/*
 * The book's text, in pages or scrolled: breader's FlowView (features/reader/FlowView.tsx), without
 * reading aloud, pictures, comments or Immersive's numbered paragraphs. A book of the writer's is
 * its chapters' prose and nothing else.
 */

/** Gap between columns (and between page views). */
export const GAP = 80;
/** The lines of controls above and below the text (instrument.css), which cover a scrolled page's edges. */
export const BAR = 76;

export interface Loc {
  section: number;
  block: number;
  offset: number;
  progress: number;
  sectionWordsLeft: number;
  bookWordsLeft: number;
  line: string;
  page: number;
  pages: number;
}

/** Where to open: an exact position, or a fraction of the book plus the saved sentence to look for. */
export type Start = { kind: 'pos'; pos: Position } | { kind: 'fraction'; value: number; line?: string };

export interface ViewHandle {
  goTo: (section: number) => void;
  /** Open at a fraction of the whole book. */
  goToFraction: (f: number) => void;
  turn: (dir: 1 | -1) => void;
}

type Target =
  | { kind: 'start' }
  | { kind: 'end' }
  /** `y`: scrolled, how far down the view to put it (just under the top line of controls, if not said). */
  | { kind: 'pos'; block: number; offset: number; y?: number }
  | { kind: 'words'; value: number }
  | { kind: 'text'; needle: string };

const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
const plain = (html: string) =>
  norm(html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));

interface Props {
  book: FlowBook;
  style: Style;
  s: StyleSettings;
  start: Start;
  turnStyle: TurnStyle;
  onLocation: (l: Loc) => void;
  onWidth: (w: number) => void;
  /** The line of controls above the text is showing, over the top of a scrolled page. */
  head?: boolean;
}

const PAGE_SPRING = { type: 'spring', stiffness: 158, damping: 25.1, mass: 1 } as const;

function resolveStart(book: FlowBook, starts: number[], start: Start): { section: number; target: Target } {
  if (start.kind === 'pos' && start.pos.section < book.sections.length) {
    return { section: start.pos.section, target: { kind: 'pos', block: start.pos.block, offset: start.pos.offset } };
  }
  const f = start.kind === 'fraction' ? start.value : 0;
  if (f <= 0 || f >= 1) return { section: 0, target: { kind: 'start' } };
  // Prefer the saved sentence itself: a chapter rewritten since moves the words under a percentage.
  const needle = start.kind === 'fraction' && start.line ? norm(start.line).slice(0, 60) : '';
  if (needle.length >= 12) {
    const guess = Math.floor(f * book.sections.length);
    const order = book.sections.map((_, i) => i).sort((a, b) => Math.abs(a - guess) - Math.abs(b - guess));
    const hit = order.find((i) => plain(book.sections[i].html).includes(needle));
    if (hit !== undefined) return { section: hit, target: { kind: 'text', needle } };
  }
  const w = f * book.words;
  let s = 0;
  while (s + 1 < starts.length && starts[s + 1] <= w) s++;
  return { section: s, target: { kind: 'words', value: w - starts[s] } };
}

export const FlowView = forwardRef<ViewHandle, Props>(function FlowView({ book, style, s, start, turnStyle, onLocation, onWidth, head = true }, ref) {
  const n = book.sections.length;
  const starts = useMemo(() => {
    let acc = 0;
    return book.sections.map((sec) => { const at = acc; acc += sec.words; return at; });
  }, [book]);
  const [init] = useState(() => resolveStart(book, starts, start));
  const [section, setSection] = useState(init.section);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [fontTick, setFontTick] = useState(0);

  const pending = useRef<Target | null>(init.target);
  const loc = useRef({ block: 0, offset: 0 });
  /** Scrolled: how far down the view the reader's place is, to put it back there after a change of size or font. */
  const locY = useRef<number | null>(null);
  const pageRef = useRef(0);
  const pagesRef = useRef(1);
  const rootRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const blocks = useRef<HTMLElement[]>([]);
  const blockWords = useRef<number[]>([]);
  /** The text the blocks were collected from: a chapter written again while it's open is collected afresh. */
  const taggedHtml = useRef<string | null>(null);
  const onLocationRef = useRef(onLocation);
  onLocationRef.current = onLocation;
  /** Direction of the chapter change being landed, for the arrival animation. */
  const arriving = useRef<1 | -1 | 0>(0);
  const swap = swaps(turnStyle);

  const pagesMode = s.layout === 'pages';
  // On a phone the words run to 12px from each edge: every bit of a small screen goes to the text.
  const colW = Math.max(260, Math.min(s.measure, size.w - (size.w < 640 ? 24 : 96)));
  const spread = style === 'book' && pagesMode && size.w >= 2 * s.measure + GAP + 160;
  const viewW = spread ? colW * 2 + GAP : colW;
  const step = viewW + GAP;

  useEffect(() => { onWidth(pagesMode ? viewW : colW); }, [onWidth, pagesMode, viewW, colW]);

  useLayoutEffect(() => {
    const el = rootRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return;
    const bump = () => setFontTick((t) => t + 1);
    fonts.addEventListener('loadingdone', bump);
    return () => fonts.removeEventListener('loadingdone', bump);
  }, []);

  const html = useMemo(() => ({ __html: book.sections[section]?.html ?? '' }), [book, section]);

  /* Geometry */
  const flowLeft = () => flowRef.current!.getBoundingClientRect().left;

  /** The last box of the text. */
  const textEnds = () => {
    const bl = blocks.current;
    const last = bl[bl.length - 1] ?? (flowRef.current!.lastElementChild as HTMLElement | null);
    if (!last) return [];
    const rects = last.getClientRects();
    return [rects[rects.length - 1] ?? last.getBoundingClientRect()];
  };

  const measurePages = () => {
    const ends = textEnds().map((r) => r.left);
    if (!ends.length) return 1;
    return Math.max(1, Math.floor((Math.max(...ends) - flowLeft() + 1) / step) + 1);
  };

  /** The text's end is on screen: the book has been read to its last word. */
  const textEndShown = () => {
    const ends = textEnds();
    if (!ends.length) return true;
    if (pagesMode) return pageRef.current >= pagesRef.current - 1;
    const v = viewRef.current!;
    if (v.scrollTop + v.clientHeight >= v.scrollHeight - 4) return true;
    return Math.max(...ends.map((r) => r.bottom)) <= v.getBoundingClientRect().bottom + 4;
  };

  const pageAt = (r: DOMRect) => Math.max(0, Math.min(pagesRef.current - 1, Math.floor((r.left - flowLeft() + 1) / step)));

  const pageOf = (block: number, offset: number) => {
    const el = blocks.current[block];
    const r = el ? charRect(el, offset) : null;
    return r ? pageAt(r) : 0;
  };

  /** The first character on screen (scrolled: from `below` pixels down the view), and how far down it is. */
  const locate = (below = 8): { block: number; offset: number; y?: number } => {
    const bl = blocks.current;
    if (!bl.length) return { block: 0, offset: 0 };
    if (pagesMode) {
      const fl = flowLeft();
      const x0 = pageRef.current * step;
      const x1 = x0 + viewW;
      for (let i = 0; i < bl.length; i++) {
        let hit = false;
        for (const r of Array.from(bl[i].getClientRects())) {
          if (!r.width && !r.height) continue;
          if (r.right - fl > x0 + 1 && r.left - fl < x1 - 1) { hit = true; break; }
        }
        if (!hit) continue;
        const f = firstRect(bl[i]);
        if (!f || f.left - fl >= x0 - 1) return { block: i, offset: 0 };
        return { block: i, offset: firstCharWhere(bl[i], (r) => r.left - fl >= x0 - 1) };
      }
      return { block: bl.length - 1, offset: 0 };
    }
    const box = viewRef.current!.getBoundingClientRect().top;
    const top = box + below;
    for (let i = 0; i < bl.length; i++) {
      const r = bl[i].getBoundingClientRect();
      if (r.bottom <= top) continue;
      if (r.top >= top - 1) return { block: i, offset: 0, y: r.top - box };
      const offset = firstCharWhere(bl[i], (c) => c.top >= top - 1);
      return { block: i, offset, y: (charRect(bl[i], offset)?.top ?? top) - box };
    }
    return { block: bl.length - 1, offset: 0 };
  };

  /** The reader's place: the first character on screen. */
  const locateNow = () => {
    const { block, offset, y } = locate();
    locY.current = y ?? null;
    return { block, offset };
  };

  /** The sentence the place is kept by; headings defer to the next real text. */
  const lineAt = (block: number, offset: number) => {
    const bl = blocks.current;
    const el = bl[block];
    const text = el?.textContent?.trim() ?? '';
    if (text && !/^H[1-6]$/.test(el.tagName)) return sentenceAt(el.textContent ?? '', offset);
    for (let i = block + 1; i < Math.min(bl.length, block + 40); i++) {
      if (/^H[1-6]$/.test(bl[i].tagName)) continue;
      const t = bl[i].textContent?.trim();
      if (t) return sentenceAt(t, 0);
    }
    return text || book.title;
  };

  const report = () => {
    const { block, offset } = loc.current;
    const el = blocks.current[block];
    const text = el?.textContent ?? '';
    const into = (blockWords.current[block] ?? 0) + countWords(text.slice(0, offset));
    const secWords = Math.max(book.sections[section]?.words ?? 0, into);
    const done = starts[section] + into;
    const atEnd = section === n - 1 && textEndShown();
    let progress = 0;
    if (atEnd) progress = 1;
    else if (book.words) progress = Math.min(0.999, done / book.words);
    onLocationRef.current({
      section,
      block,
      offset,
      progress,
      sectionWordsLeft: Math.max(0, secWords - into),
      bookWordsLeft: atEnd ? 0 : Math.max(0, book.words - done),
      line: lineAt(block, offset),
      page: pageRef.current,
      pages: pagesRef.current,
    });
  };

  const setX = (p: number, instant: boolean) => {
    const el = flowRef.current;
    if (!el) return;
    animate(el, { x: -p * step }, instant ? { duration: 0 } : PAGE_SPRING);
    // A view transition snapshots the next frame, so an instant move lands now, not a frame later.
    if (instant) el.style.transform = `translateX(${-p * step}px)`;
  };

  const land = (t: Target) => {
    const bl = blocks.current;
    let block = 0;
    let offset = 0;
    if (t.kind === 'pos') {
      block = Math.min(t.block, Math.max(0, bl.length - 1));
      offset = t.offset;
    } else if (t.kind === 'words') {
      const bw = blockWords.current;
      while (block + 1 < bw.length && bw[block + 1] <= t.value) block++;
    } else if (t.kind === 'text') {
      const i = bl.findIndex((b) => norm(b.textContent ?? '').includes(t.needle));
      if (i >= 0) {
        block = i;
        const raw = bl[i].textContent ?? '';
        const head = t.needle.slice(0, 16);
        const at = raw.replace(/\s+/g, ' ').indexOf(head);
        offset = Math.max(0, at);
      }
    }
    const precise = t.kind === 'pos' || t.kind === 'words' || t.kind === 'text';
    if (pagesMode) {
      const total = measurePages();
      pagesRef.current = total;
      setPages(total);
      let p = pageOf(block, offset);
      if (t.kind === 'end') p = total - 1;
      if (t.kind === 'start') p = 0;
      pageRef.current = p;
      setPage(p);
      setX(p, true);
    } else {
      const v = viewRef.current!;
      stopGlide(v);
      if (t.kind === 'start') v.scrollTop = 0;
      else if (t.kind === 'end') v.scrollTop = v.scrollHeight;
      else {
        const r = bl[block] ? charRect(bl[block], offset) : null;
        if (r) v.scrollTop += r.top - v.getBoundingClientRect().top - (t.kind === 'pos' ? t.y ?? 88 : 88);
      }
      pagesRef.current = 1;
      setPages(1);
      pageRef.current = 0;
      setPage(0);
    }
    if (precise) {
      loc.current = { block, offset };
      const r = !pagesMode && bl[block] ? charRect(bl[block], offset) : null;
      locY.current = r ? r.top - viewRef.current!.getBoundingClientRect().top : null;
    } else loc.current = locateNow();
    report();
  };

  useLayoutEffect(() => {
    const flow = flowRef.current;
    if (!flow || !size.w) return;
    const newText = taggedHtml.current !== html.__html;
    if (newText) {
      blocks.current = collectBlocks(flow);
      let acc = 0;
      blockWords.current = blocks.current.map((b) => { const at = acc; acc += countWords(b.textContent ?? ''); return at; });
      taggedHtml.current = html.__html;
    }
    if (!pagesMode) { animate(flow, { x: 0 }, { duration: 0 }); flow.style.transform = ''; }
    // Nowhere new to go: the place stays where it was on screen.
    const t: Target = pending.current ?? { kind: 'pos', block: loc.current.block, offset: loc.current.offset, y: locY.current ?? undefined };
    pending.current = null;
    land(t);
    const dir = arriving.current;
    arriving.current = 0;
    if (newText && (!dir || !swap)) {
      flow.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, size.w, size.h, pagesMode, viewW, colW, s.font, s.size, s.lh, s.justify, style, fontTick]);

  const goSection = (i: number, t: Target, towards?: 1 | -1) => {
    if (i < 0 || i >= n) return;
    const dir = towards ?? (i >= section ? 1 : -1);
    const move = () => {
      if (i === section) {
        pending.current = null;
        land(t);
      } else {
        pending.current = t;
        arriving.current = dir;
        // Inside a view transition the new chapter has to be on screen before the callback returns.
        if (swap) flushSync(() => setSection(i));
        else setSection(i);
      }
    };
    runTurn(turnStyle, dir, 'chapter', move, viewRef.current?.getBoundingClientRect());
  };

  const turn = (dir: 1 | -1) => {
    if (!pagesMode) {
      const v = viewRef.current!;
      if (dir > 0 && v.scrollTop + v.clientHeight >= v.scrollHeight - 4) { if (section < n - 1) goSection(section + 1, { kind: 'start' }, 1); return; }
      if (dir < 0 && v.scrollTop <= 0) { if (section > 0) goSection(section - 1, { kind: 'end' }, -1); return; }
      // What can be seen between the lines of controls, less two lines to read on from, so none
      // go by unseen under them.
      const lines = s.size * s.lh * 2;
      glide(v, dir * Math.max(lines, v.clientHeight - (head ? BAR : 0) - BAR - lines));
      return;
    }
    const np = pageRef.current + dir;
    if (np < 0) { if (section > 0) goSection(section - 1, { kind: 'end' }, -1); return; }
    if (np >= pagesRef.current) { if (section < n - 1) goSection(section + 1, { kind: 'start' }, 1); return; }
    const move = () => {
      pageRef.current = np;
      if (swap) flushSync(() => setPage(np));
      else setPage(np);
      setX(np, swap);
      loc.current = locateNow();
      report();
    };
    runTurn(turnStyle, dir, 'page', move, viewRef.current?.getBoundingClientRect());
  };

  useImperativeHandle(ref, () => ({
    goTo: (i) => goSection(i, { kind: 'start' }),
    goToFraction: (f) => {
      const at = resolveStart(book, starts, { kind: 'fraction', value: Math.min(0.999, Math.max(0, f)) });
      goSection(at.section, at.target);
    },
    turn,
  }));

  const scrollFrame = useRef(0);
  const onScroll = () => {
    cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = requestAnimationFrame(() => {
      loc.current = locateNow();
      report();
    });
  };

  const onZone = (dir: 1 | -1) => {
    if (window.getSelection()?.toString()) return;
    turn(dir);
  };

  const cssVars = {
    '--rf': fontFamily(s.font),
    '--rs': `${s.size}px`,
    '--rl': s.lh,
    '--cw': `${colW}px`,
    '--vw': `${viewW}px`,
    '--gap': `${GAP}px`,
  } as CSSProperties;

  let className = `fv ${pagesMode ? 'is-pages' : 'is-scroll'}`;
  if (s.justify) className += ' is-justified';
  if (spread) className += ' is-spread';

  return (
    <div ref={rootRef} className={className} style={cssVars}>
      <div ref={viewRef} className="fv-view" onScroll={pagesMode ? undefined : onScroll}>
        {!pagesMode && section > 0 && (
          <div className="fv-prev">
            <button type="button" className="btn btn-ghost" onClick={() => goSection(section - 1, { kind: 'start' })}>‹ {book.sections[section - 1]?.title}</button>
          </div>
        )}
        <div ref={flowRef} className="fv-flow" dangerouslySetInnerHTML={html} />
        {!pagesMode && section < n - 1 && (
          <div className="fv-next">
            <button type="button" className="btn btn-quiet" onClick={() => goSection(section + 1, { kind: 'start' })}>
              Next: {book.sections[section + 1]?.title} ›
            </button>
          </div>
        )}
        {!pagesMode && section >= n - 1 && <div className="fv-next" />}
      </div>
      {pagesMode && (
        <>
          <div className="fv-folio">{pages > 1 ? `${page + 1} of ${pages}` : ''}</div>
          <button type="button" tabIndex={-1} className="fv-zone is-prev" aria-label="Previous page" onClick={() => onZone(-1)}><span>‹</span></button>
          <button type="button" tabIndex={-1} className="fv-zone is-next" aria-label="Next page" onClick={() => onZone(1)}><span>›</span></button>
        </>
      )}
    </div>
  );
});
