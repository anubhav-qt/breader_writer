import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useIsPresent, type HTMLMotionProps } from 'motion/react';
import { minutesFor } from '../../../lib/format';
import { springs } from '../../../lib/springs';
import { chapterAtFraction, chapterName, type Chapter } from '../chapters';
import type { Loc } from '../FlowView';
import { AppearancePanel, ContentsPanel } from '../Panels';
import type { ReaderSettings } from '../settings';
import type { FlowBook, TocItem } from '../types';
import { GROW, SHRINK } from './icons';
import { ChapterLabel, CloseDots, Digits, DotIcon, Typed } from './parts';

/*
 * The book's controls: breader's (features/reader/chrome/Instrument.tsx), for a book of text with
 * no voices, AI, comments or search. Doto leads: the page's margins are readouts. The line above
 * the text names the chapter and turns into controls under the pointer; the line below is a
 * dot-matrix of the whole book.
 */

export type PanelName = 'toc' | 'look';

const DROP_CLOSED = 'inset(-12% -24% 100% -24%)';
const DROP_OPEN = 'inset(-12% -24% -40% -24%)';

export interface ChromeProps {
  book: FlowBook;
  loc: Loc | null;
  chapters: Chapter[];
  current: number;
  settings: ReaderSettings;
  update: (fn: (s: ReaderSettings) => ReaderSettings) => void;
  panel: PanelName | null;
  openPanel: (p: PanelName | null) => void;
  /** Back to the play. */
  onBack: () => void;
  onGo: (item: TocItem) => void;
  onPick: (f: number) => void;
  focus: { on: boolean; toggle: () => void };
  /** What the contents end with: the download, and what's still being written. */
  contentsEnd: ReactNode;
}

export function InstrumentChrome({ book, loc, chapters, current, settings, update, panel, openPanel, onBack, onGo, onPick, focus, contentsEnd }: ChromeProps) {
  const [head, setHead] = useState(false);
  const [foot, setFoot] = useState(false);
  const progress = loc?.progress ?? 0;
  let label = book.title;
  if (chapters.length > 1) label = chapterName(chapters, current);
  const toggle = (k: PanelName) => openPanel(panel === k ? null : k);

  let fullLabel = 'Full screen';
  if (focus.on) fullLabel = 'Leave full screen';

  return (
    <>
      <div className={`i3-head${head || panel ? ' is-on' : ''}`} onPointerEnter={() => setHead(true)} onPointerLeave={() => setHead(false)}>
        <button type="button" className="i3-side" onClick={onBack} aria-label="Back to the play">‹<span className="i3-back-word"> Play</span></button>
        <button type="button" className={`i3-mid${panel === 'toc' ? ' is-open' : ''}`} onClick={() => toggle('toc')} aria-label={`Contents. ${label}`} aria-expanded={panel === 'toc'}>
          <Typed text={label} />
          <span className="i3-caret" aria-hidden="true">▾</span>
        </button>
        <div className="i3-ends">
          <button type="button" className={`i3-side i3-aa${panel === 'look' ? ' is-open' : ''}`} onClick={() => toggle('look')} aria-label="Appearance" aria-expanded={panel === 'look'}>Aa</button>
          <button type="button" className={`i3-side i3-icon${focus.on ? ' is-open' : ''}`} onClick={focus.toggle} aria-label={fullLabel} aria-pressed={focus.on}>
            <DotIcon rows={focus.on ? SHRINK : GROW} />
          </button>
        </div>
      </div>

      <div className={`i3-foot${foot ? ' is-on' : ''}`} onPointerEnter={() => setFoot(true)} onPointerLeave={() => setFoot(false)}>
        <span className="i3-left">
          <span className="i3-read"><Digits value={Math.floor(progress * 100)} width={3} /><small>%</small></span>
        </span>
        <Dots chapters={chapters} progress={progress} onPick={onPick} />
        <span className="i3-read is-right">
          {loc && <><Digits value={minutesFor(loc.sectionWordsLeft)} width={2} /><small>min</small></>}
        </span>
      </div>

      {/* Clear, so nothing to fade: it goes with the tap that closes the drop, never left over the page. */}
      {panel && <div className="i3-scrim" onClick={() => openPanel(null)} />}
      <AnimatePresence>
        {panel && (
          <Drop
            key={panel}
            className={`i3-drop is-${panel}`}
            data-panel
            initial={{ clipPath: DROP_CLOSED, y: -6 }}
            animate={{ clipPath: DROP_OPEN, y: 0 }}
            exit={{ clipPath: DROP_CLOSED, y: -6 }}
            transition={springs.snappy}
          >
            {/* The drop keeps its close button in place; what's in it scrolls. */}
            <div className="i3-drop-in">
              {panel === 'toc' ? (
                <ContentsPanel book={book} loc={loc} onGo={(it) => { openPanel(null); onGo(it); }}>{contentsEnd}</ContentsPanel>
              ) : (
                <AppearancePanel settings={settings} update={update} />
              )}
            </div>
            <CloseDots onClick={() => openPanel(null)} />
          </Drop>
        )}
      </AnimatePresence>
    </>
  );
}

/** A drop on its way out takes no taps, so one that never quite leaves can't sit over the page. */
function Drop(props: HTMLMotionProps<'div'>) {
  const present = useIsPresent();
  return <motion.div {...props} style={present ? props.style : { ...props.style, pointerEvents: 'none' }} />;
}

const PITCH = 8;
const SPLIT = 5;

/** The whole book as a row of square dots: lit in the book's colour as you read, grouped by chapter. */
function Dots({ chapters, progress, onPick }: { chapters: Chapter[]; progress: number; onPick: (f: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [hover, setHover] = useState<{ k: number; x: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // The row always fits the width it's given (the column can shrink below it), so it follows the
  // bar when it narrows: switching to scroll, leaving a two-page spread, a smaller window.
  // Chapter gaps only when they leave room for a dozen dots.
  const splits = chapters.length - 1;
  const grouped = chapters.length >= 3 && chapters.length <= 40 && w - splits * SPLIT >= 12 * PITCH;
  const n = Math.max(1, Math.min(120, Math.floor((w - (grouped ? splits * SPLIT : 0)) / PITCH)));
  const dots = Array.from({ length: n }, (_, i) => {
    const f0 = i / n;
    const f1 = (i + 1) / n;
    let state = 'next';
    if (f1 <= progress) state = 'read';
    else if (f0 <= progress) state = 'now';
    return { f: (f0 + f1) / 2, ch: chapterAtFraction(chapters, (f0 + f1) / 2), state };
  });
  const hoverCh = hover ? dots[hover.k]?.ch : null;

  return (
    <div
      ref={ref}
      className="i3-dots"
      role="group"
      aria-label="Progress through the book"
      onPointerLeave={() => setHover(null)}
      onClick={() => { if (hover && dots[hover.k]) onPick(dots[hover.k].f); }}
    >
      {w > 0 && dots.map((d, k) => (
        <span
          key={k}
          className={`i3-dot is-${d.state}${grouped && k > 0 && dots[k - 1].ch !== d.ch ? ' is-split' : ''}${hoverCh === d.ch ? ' is-hover' : ''}`}
          onPointerEnter={(e) => setHover({ k, x: e.currentTarget.offsetLeft })}
        />
      ))}
      {hover && dots[hover.k] && (
        <div className="i3-tip" style={{ left: Math.max(110, Math.min(w - 110, hover.x)) }}>
          <ChapterLabel chapters={chapters} i={dots[hover.k].ch} f={dots[hover.k].f} />
        </div>
      )}
    </div>
  );
}
