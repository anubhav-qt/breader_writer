import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { pairKey } from '@writer/shared/book';
import type { SetupChange } from '@writer/shared/chat';
import { fieldKey, type FieldRef } from '@writer/shared/suggestions';

/*
 * Approved changes land on the page one after another, each with a soft glow where it went: its
 * field, someone's card, a choice or a line in the graph (the owner's pick, 2026-10-07). Each of
 * those places has a key; what's glowing is a set of them, which the places read, and the page
 * scrolls to each in turn (`data-land` marks where).
 */

/** How long a glow stays on once lit. */
const GLOW_MS = 1400;

/** How long each change has to itself before the next one lands. */
export const LAND_GAP = 650;

/** The keys of the places glowing now. */
export const GlowContext = createContext<ReadonlySet<string>>(new Set());

/** Whether the place with this key is glowing. A place without a key never is. */
export function useGlowing(key: string | undefined): boolean {
  const glowing = useContext(GlowContext);
  if (key === undefined) {
    return false;
  }
  return glowing.has(key);
}

/** A field's place. */
export function fieldSpot(field: FieldRef): string {
  return `field ${fieldKey(field)}`;
}

/** Someone's card in the cast. */
export function personSpot(id: string): string {
  return `person ${id}`;
}

/** A line in the graph. */
export function lineSpot(one: string, other: string): string {
  return `line ${pairKey(one, other)}`;
}

/** One of the book's choices: its length, point of view or how dark it goes. */
export function choiceSpot(choice: 'length' | 'pov' | 'darkness'): string {
  return `choice ${choice}`;
}

export const CAST_SPOT = 'cast';
export const GRAPH_SPOT = 'graph';

/** Where a change lands: the places that glow, the first the one the page scrolls to. */
export function spotsOf(change: SetupChange): string[] {
  if (change.kind === 'length' || change.kind === 'pov' || change.kind === 'darkness') {
    return [choiceSpot(change.kind)];
  }
  if (change.kind === 'add') {
    return [personSpot(change.person.id)];
  }
  if (change.kind === 'remove') {
    return [CAST_SPOT];
  }
  if (change.kind === 'untie') {
    return [GRAPH_SPOT];
  }
  const field = change.field;
  // A sheet's fields aren't on the page: their card or line glows instead, and the field too in
  // case its sheet is open.
  if (field.kind === 'character') {
    return [personSpot(field.id), fieldSpot(field)];
  }
  if (field.kind === 'bond') {
    return [lineSpot(field.a, field.b), fieldSpot(field)];
  }
  if (field.kind === 'side') {
    return [lineSpot(field.id, field.other), fieldSpot(field)];
  }
  return [fieldSpot(field)];
}

/** What's glowing, and lighting places up. A place lit again while it glows stays lit. */
export function useGlow() {
  const [glowing, setGlowing] = useState<ReadonlySet<string>>(new Set());
  // How many glows each place has going, so the first to end doesn't put out a later one.
  const counts = useRef(new Map<string, number>());
  const timers = useRef(new Set<number>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  const showCounts = useCallback(() => {
    const lit = new Set<string>();
    for (const [key, count] of counts.current) {
      if (count > 0) {
        lit.add(key);
      }
    }
    setGlowing(lit);
  }, []);

  const glow = useCallback(
    (keys: string[]) => {
      for (const key of keys) {
        const count = counts.current.get(key) ?? 0;
        counts.current.set(key, count + 1);
      }
      showCounts();
      const timer = window.setTimeout(() => {
        timers.current.delete(timer);
        for (const key of keys) {
          const count = counts.current.get(key) ?? 1;
          counts.current.set(key, count - 1);
        }
        showCounts();
      }, GLOW_MS);
      timers.current.add(timer);
    },
    [showCounts],
  );

  return { glowing, glow };
}

/** Scrolls the page to a place, if it's on it. */
export function scrollToSpot(key: string) {
  const spots = document.querySelectorAll<Element>('[data-land]');
  for (const spot of spots) {
    if (spot.getAttribute('data-land') === key) {
      spot.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
  }
}

/** Waits for the next frame, so what the last change put on the page is there to scroll to. */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
