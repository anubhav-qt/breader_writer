import { useCallback, useEffect, useRef, useState } from 'react';

/*
 * Full screen (fullscreen.ts) hides everything but the page: the margins' readouts, the controls
 * and the page-turn arrows (breader's features/reader/focus.ts, without its voice bar).
 *
 * Then the controls wake when the mouse travels a little over an inch in one go, and sleep again
 * once it rests. Clicks never wake them, so turning pages doesn't bring them back. On touch
 * screens, where there's no mouse, a tap in the middle of the page does.
 */

/** A little over an inch, in CSS pixels (96 to the inch). */
const WAKE_PX = 110;
/** A pause this long between movements starts the count again. */
const GAP_MS = 250;
/** How long the controls stay after the mouse comes to rest. */
const REST_MS = 2200;
/** Controls the pointer is resting on stay awake. */
const HELD = '.i3-head:hover, .i3-foot:hover, .i3-drop:hover';

/**
 * Whether the controls are awake, and a way to wake them (on opening, or a tap mid-page). `still`
 * is the mouse at rest, when full screen hides the pointer too; any movement brings it back.
 */
export function useWake(active: boolean) {
  const [awake, setAwake] = useState(false);
  const [still, setStill] = useState(false);
  const timer = useRef(0);
  const isAwake = useRef(false);

  const sleepIn = useCallback((ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(function rest() {
      if (document.querySelector(HELD)) { timer.current = window.setTimeout(rest, REST_MS); return; }
      isAwake.current = false;
      setAwake(false);
    }, ms);
  }, []);

  const wake = useCallback((ms = REST_MS) => {
    isAwake.current = true;
    setAwake(true);
    sleepIn(ms);
  }, [sleepIn]);

  const sleep = useCallback(() => {
    window.clearTimeout(timer.current);
    isAwake.current = false;
    setAwake(false);
  }, []);

  useEffect(() => {
    if (!active) return;
    let travel = 0;
    let last: { x: number; y: number; t: number } | null = null;
    let isStill = false;
    let stillTimer = 0;
    const settle = () => { stillTimer = window.setTimeout(() => { isStill = true; setStill(true); }, REST_MS); };
    const onMove = (e: PointerEvent) => {
      // Touch moves are swipes, and a pressed button is a click or a selection being dragged.
      if (e.pointerType === 'touch' || e.buttons) { last = null; travel = 0; return; }
      const d = last ? Math.hypot(e.clientX - last.x, e.clientY - last.y) : 0;
      travel = last && e.timeStamp - last.t < GAP_MS ? travel + d : 0;
      last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      // Browsers send still "moves" when the page changes under a resting pointer; those don't count.
      if (d === 0) return;
      if (isStill) { isStill = false; setStill(false); }
      window.clearTimeout(stillTimer);
      settle();
      if (isAwake.current || travel >= WAKE_PX) { travel = 0; wake(); }
    };
    settle();
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.clearTimeout(timer.current);
      window.clearTimeout(stillTimer);
    };
  }, [active, wake]);

  return { awake, still, wake, sleep };
}
