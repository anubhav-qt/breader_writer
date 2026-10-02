import { useLayoutEffect, useRef, useState } from 'react';

/** Live content width of an element. */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Hidden (in the library tab not showing), it keeps its width, to come back as it was.
    const read = () => { if (el.getClientRects().length) setWidth(el.clientWidth); };
    const ro = new ResizeObserver(read);
    ro.observe(el);
    read();
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}
