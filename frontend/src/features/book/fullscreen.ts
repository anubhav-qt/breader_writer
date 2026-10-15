import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { readLocal, writeLocal } from '../../lib/store';

/*
 * Full screen for reading: the page has the screen to itself. Everything but the words or pictures
 * steps away until the mouse moves or a tap mid-page wakes it (focus.ts useWake), and where a
 * browser lets a page take the whole screen (Android and desktop browsers, and Safari on iPad), it
 * does. Safari on iPhone allows that only for video; there full screen hides the controls. Breader's
 * features/reader/fullscreen.ts, kept under the writer's own key.
 *
 * Whether to read full screen is kept per device, not synced: a phone and a laptop want different
 * things. It's asked for when a book opens, on the tap that opened it, and left when the book closes.
 */

const KEY = 'writer.fullscreen.v1';

type Doc = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type El = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

const doc = document as Doc;
const current = () => doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;

export const canFullscreen = () => !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);

let wanted = readLocal<boolean>(KEY, false);
/** Leaving because the book closed, not because the reader asked the browser to. */
let leaving = false;
const subscribers = new Set<() => void>();

function want(on: boolean) {
  wanted = on;
  writeLocal(KEY, on);
  subscribers.forEach((s) => s());
}

async function enter() {
  const el = document.documentElement as El;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else await el.webkitRequestFullscreen?.();
  } catch {
    // Refused: too long after the tap that opened the book, or the browser said no.
  }
}

function leave() {
  if (!current()) return;
  leaving = true;
  const done = () => { leaving = false; };
  try {
    const p = doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen?.();
    if (p) p.catch(done);
  } catch {
    done();
  }
}

function changed() {
  if (!current()) {
    // Left from outside (the back gesture, Esc): the controls come back, and the next book opens with them.
    if (leaving) leaving = false;
    else if (wanted) want(false);
  }
}
document.addEventListener('fullscreenchange', changed);
document.addEventListener('webkitfullscreenchange', changed);

const subscribe = (fn: () => void) => {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
};
const isOn = () => wanted;

/**
 * Whether the book is read full screen, and a switch for it (called from a tap, which a browser
 * needs before it lets a page fill the screen).
 */
export function useFullscreen() {
  const on = useSyncExternalStore(subscribe, isOn);
  const toggle = useCallback(() => {
    if (wanted) { want(false); leave(); }
    else { want(true); if (canFullscreen()) void enter(); }
  }, []);
  return [on, toggle] as const;
}

/** Goes full screen while a book is open, if the reader chose it on this device. */
export function useFullscreenReading(open: boolean) {
  useEffect(() => {
    if (!open || !canFullscreen()) return;
    if (wanted && !current()) void enter();
    return leave;
  }, [open]);
}
