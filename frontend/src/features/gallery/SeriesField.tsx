import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { matchSeries, type SeriesName } from './series';
import './series-field.css';

export interface SeriesValue {
  name: string;
  /** As typed: the number is checked when it's saved. */
  num: string;
}

interface Props {
  id: string;
  value: SeriesValue;
  /** Every series in either library, offered from the first letter typed. */
  known: SeriesName[];
  /** The inputs' look, from the dialog they sit in. */
  inputClass: string;
  onChange: (v: SeriesValue) => void;
  /** Focus left both fields, or Enter was pressed there: time to save. */
  onDone?: (v: SeriesValue) => void;
  autoFocus?: boolean;
}

/** Room the list wants below the field before it opens above it instead. */
const ROOM = 220;
const MIN_WIDTH = 240;
/** Kept from the window's edges. */
const EDGE = 12;

/**
 * A series name and its number. As the name is typed, the series already in the library and the
 * Shared Library drop down under it; picking one moves on to the number.
 */
export function SeriesField({ id, value, known, inputClass, onChange, onDone, autoFocus }: Props) {
  const groupRef = useRef<HTMLDivElement>(null);
  const numRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [box, setBox] = useState<CSSProperties | null>(null);
  const matches = useMemo(() => matchSeries(known, value.name), [known, value.name]);
  const showing = open && matches.length > 0;
  const listId = `${id}-list`;

  // Out of the dialog, which scrolls and would clip it, and pinned under the field.
  useLayoutEffect(() => {
    if (!showing) return;
    const place = () => {
      const el = groupRef.current;
      if (!el) return;
      // As wide as the name and number together, so long names fit.
      const r = el.getBoundingClientRect();
      const vv = window.visualViewport;
      const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const above = bottom - r.bottom < ROOM && r.top > bottom - r.bottom;
      const width = Math.min(Math.max(r.width, MIN_WIDTH), window.innerWidth - 2 * EDGE);
      const left = Math.max(EDGE, Math.min(r.left, window.innerWidth - EDGE - width));
      setBox({ left, width, ...(above ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }) });
    };
    place();
    window.addEventListener('resize', place);
    window.visualViewport?.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
    };
  }, [showing]);

  const pick = (s: SeriesName) => {
    onChange({ ...value, name: s.name });
    setOpen(false);
    setActive(-1);
    numRef.current?.focus();
    numRef.current?.select();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const n = matches.length;
    if (e.key === 'ArrowDown' && n) {
      e.preventDefault();
      setOpen(true);
      setActive(showing ? (active + 1) % n : 0);
    } else if (e.key === 'ArrowUp' && showing) {
      e.preventDefault();
      setActive(active <= 0 ? n - 1 : active - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (showing && active >= 0) pick(matches[active]);
      else e.currentTarget.blur();
    } else if (e.key === 'Escape' && showing) {
      // Closes the list, not the dialog around it.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setActive(-1);
    }
  };

  return (
    <div
      ref={groupRef}
      className="sf"
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setOpen(false);
        setActive(-1);
        onDone?.(value);
      }}
    >
      <input
        id={id}
        className={inputClass}
        value={value.name}
        placeholder="None"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showing}
        aria-controls={listId}
        aria-activedescendant={showing && active >= 0 ? `${id}-${active}` : undefined}
        onChange={(e) => { onChange({ ...value, name: e.target.value }); setOpen(true); setActive(-1); }}
        onKeyDown={onKey}
        spellCheck={false}
        autoComplete="off"
        autoFocus={autoFocus}
      />
      <input
        ref={numRef}
        className={`${inputClass} sf-num`}
        value={value.num}
        inputMode="decimal"
        placeholder="#"
        aria-label="Number in the series"
        onChange={(e) => onChange({ ...value, num: e.target.value })}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
        autoComplete="off"
      />
      {showing && box && createPortal(
        <ul
          id={listId}
          className="sf-list"
          role="listbox"
          aria-label="Series"
          style={box}
          // Keeps focus in the field, and tells the dialog underneath this isn't a click away from it.
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          {matches.map((s, i) => (
            <li
              key={s.name}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`sf-opt${i === active ? ' is-on' : ''}`}
              onPointerEnter={() => setActive(i)}
              onClick={() => pick(s)}
            >
              <span className="sf-name">{s.name}</span>
              <span className="sf-count">{s.count === 1 ? '1 book' : `${s.count} books`}</span>
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  );
}
