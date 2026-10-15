import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode, type TouchEvent } from 'react';
import { paintBars } from '../../lib/bars';
import { chapterAt, chaptersOf } from './chapters';
import { InstrumentChrome, type PanelName } from './chrome/Instrument';
import { FlowView, type Loc, type Start, type ViewHandle } from './FlowView';
import { useWake } from './focus';
import { useFullscreen, useFullscreenReading } from './fullscreen';
import { useReaderSettings } from './settings';
import type { FlowBook, TocItem } from './types';
import './reader.css';
import './instrument.css';

/*
 * Reading the book: breader's reader (features/reader/Reader.tsx), cut down to a book of text.
 * Pages or scrolling, the contents, how it looks, full screen, the progress dots and the place kept,
 * without voices, Immersive, comments, search or AI.
 */

interface Props {
  book: FlowBook;
  /** The book's palette colour (data/colors.ts). */
  color: string;
  start: Start;
  onBack: () => void;
  /** The reader's place, as it moves. */
  onPlace: (loc: Loc) => void;
  /** What the contents end with: the download, and what's still being written. */
  contentsEnd: ReactNode;
}

export function Reader({ book, color, start, onBack, onPlace, contentsEnd }: Props) {
  const [settings, update] = useReaderSettings();
  const [panel, setPanel] = useState<PanelName | null>(null);
  const [loc, setLoc] = useState<Loc | null>(null);
  const [pageW, setPageW] = useState(0);
  const view = useRef<ViewHandle>(null);
  const body = useRef<HTMLDivElement>(null);
  const chapters = useMemo(() => chaptersOf(book), [book]);
  const current = chapterAt(chapters, loc);

  useFullscreenReading(true);
  // Full screen: the page to itself, the controls asleep until they're wanted (fullscreen.ts).
  const [focus, toggleFocus] = useFullscreen();
  const { awake, still, wake, sleep } = useWake(true);
  // Opening full screen shows where the controls are before they go.
  useEffect(() => { if (focus) wake(1800); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onLocation = useCallback((l: Loc) => {
    setLoc(l);
    onPlace(l);
  }, [onPlace]);

  /* A quick, mostly sideways swipe turns the page in the paged layout. */
  const layout = settings[settings.style].layout;
  const paged = layout !== 'scroll';
  const swipe = useRef<{ x: number; y: number; t: number } | null>(null);
  const swipedAt = useRef(-Infinity);
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    swipe.current = paged && e.touches.length === 1 ? { x: t.clientX, y: t.clientY, t: e.timeStamp } : null;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || e.touches.length) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.4 || e.timeStamp - s.t > 800) return;
    if (window.getSelection()?.toString()) return;
    swipedAt.current = e.timeStamp;
    view.current?.turn(dx < 0 ? 1 : -1);
  };
  // The tap zones under a swipe mustn't turn the page a second time.
  const onClickCapture = (e: MouseEvent) => {
    if (e.timeStamp - swipedAt.current < 500) { e.stopPropagation(); e.preventDefault(); }
  };
  // Touch screens, which have no mouse to wake the controls, wake them with a tap mid-page in full
  // screen, and hide them again.
  const touched = useRef(false);
  const onPointerDown = (e: PointerEvent) => {
    touched.current = e.pointerType === 'touch';
  };
  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented) return;
    if ((e.target as HTMLElement).closest('a, button, input, select, textarea')) return;
    if (window.getSelection()?.toString()) return;
    if (!focus || !touched.current) return;
    if (awake) sleep();
    else wake(3500);
  };

  useEffect(() => {
    // A button clicked keeps the focus, and the browser rings it at the next key: a page turned by
    // key lets go of it first. One reached with Tab keeps its ring.
    let clicked: Element | null = null;
    const onDown = (e: Event) => { clicked = (e.target as Element).closest?.('button') ?? null; };
    const letGo = () => {
      const a = document.activeElement;
      if (a instanceof HTMLElement && a === clicked) a.blur();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (panel) setPanel(null);
        else onBack();
        return;
      }
      const target = e.target as HTMLElement;
      if (target.closest('[data-panel], input, textarea, [role="dialog"]')) return;
      const scroll = layout === 'scroll';
      const forward = e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey && !scroll);
      const back = e.key === 'ArrowLeft' || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey && !scroll);
      if (forward) {
        letGo();
        view.current?.turn(1);
        e.preventDefault();
      } else if (back) {
        letGo();
        view.current?.turn(-1);
        e.preventDefault();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [panel, layout, onBack]);

  // The phone's status bar takes the page's colour while the book is open.
  const theme = settings.theme;
  useEffect(() => {
    const bg = body.current && getComputedStyle(body.current).getPropertyValue('--r-bg').trim();
    if (!bg) return;
    return paintBars(bg);
  }, [theme]);

  const onGo = useCallback((item: TocItem) => view.current?.goTo(item.section), []);
  const onPick = useCallback((f: number) => {
    if (chapters.length < 3) { view.current?.goToFraction(f); return; }
    let at = 0;
    chapters.forEach((c, i) => { if (c.start <= f) at = i; });
    view.current?.goTo(chapters[at].section);
  }, [chapters]);

  const vars: Record<string, string> = {
    '--book': `var(--bc-${color})`,
    '--book-ink': `var(--bc-${color}-ink)`,
    '--pw': `${pageW}px`,
  };

  let className = `rd t-${settings.theme} st-${settings.style}`;
  if (focus) className += ' is-focus';
  if (awake || panel) className += ' is-awake';
  if (still && !panel) className += ' is-still';

  return (
    <div className={className} style={vars as CSSProperties}>
      <div className="rd-body" ref={body}>
        <main className="rd-stage" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onClickCapture={onClickCapture} onPointerDown={onPointerDown} onClick={onClick}>
          <FlowView ref={view} book={book} style={settings.style} s={settings[settings.style]} start={start} turnStyle="wipe" onLocation={onLocation} onWidth={setPageW} head={!focus || awake || !!panel} />
        </main>
        <div className="rd-chrome">
          <InstrumentChrome
            book={book}
            loc={loc}
            chapters={chapters}
            current={current}
            settings={settings}
            update={update}
            panel={panel}
            openPanel={setPanel}
            onBack={onBack}
            onGo={onGo}
            onPick={onPick}
            focus={{ on: focus, toggle: toggleFocus }}
            contentsEnd={contentsEnd}
          />
        </div>
      </div>
    </div>
  );
}
