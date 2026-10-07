import { useEffect, useState } from 'react';

/** Whether a media query matches, kept up to date as the window changes. */
export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => {
      setMatches(list.matches);
    };
    // The query may have changed since the first render.
    update();
    list.addEventListener('change', update);
    return () => {
      list.removeEventListener('change', update);
    };
  }, [query]);

  return matches;
}
