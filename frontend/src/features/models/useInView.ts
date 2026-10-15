import { useEffect, useRef } from 'react';

/** Brings a part that just opened into view: the menu scrolls once it's long, and these open at its end. */
export function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest' });
  }, []);
  return ref;
}
