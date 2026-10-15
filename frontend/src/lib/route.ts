import { useEffect, useState } from 'react';

/*
 * The writer's pages, by their address under /writer/:
 *
 *   /writer/                      the library
 *   /writer/new                   setting up a new book
 *   /writer/books/<id>            playing a book
 *   /writer/books/<id>/book       reading the book as it's written
 *   /writer/books/<id>/setup      what a book was set up with
 *
 * Moving between them changes the address without loading the page again, so the back button
 * and links work. Anything else is the library.
 */
export type Route =
  | { page: 'library' }
  | { page: 'new' }
  | { page: 'play'; bookId: string }
  | { page: 'read'; bookId: string }
  | { page: 'setup'; bookId: string };

const BASE = import.meta.env.BASE_URL;

export function routeFrom(pathname: string): Route {
  let rest = pathname;
  if (rest.startsWith(BASE)) {
    rest = rest.slice(BASE.length);
  }
  const parts = rest.split('/').filter((part) => part !== '');
  if (parts.length === 1 && parts[0] === 'new') {
    return { page: 'new' };
  }
  if (parts.length === 2 && parts[0] === 'books') {
    return { page: 'play', bookId: parts[1] };
  }
  if (parts.length === 3 && parts[0] === 'books' && parts[2] === 'setup') {
    return { page: 'setup', bookId: parts[1] };
  }
  if (parts.length === 3 && parts[0] === 'books' && parts[2] === 'book') {
    return { page: 'read', bookId: parts[1] };
  }
  return { page: 'library' };
}

export function pathOf(route: Route): string {
  if (route.page === 'new') {
    return `${BASE}new`;
  }
  if (route.page === 'play') {
    return `${BASE}books/${route.bookId}`;
  }
  if (route.page === 'setup') {
    return `${BASE}books/${route.bookId}/setup`;
  }
  if (route.page === 'read') {
    return `${BASE}books/${route.bookId}/book`;
  }
  return BASE;
}

/** Opens a page. Search params (like the preview bar's) stay as they are. */
export function go(route: Route) {
  const url = new URL(window.location.href);
  url.pathname = pathOf(route);
  window.history.pushState(null, '', url);
  // pushState doesn't tell anyone, so the page says it changed the way the back button does.
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** The page the address is on, kept up to date. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => routeFrom(window.location.pathname));
  useEffect(() => {
    const onChange = () => setRoute(routeFrom(window.location.pathname));
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
  }, []);
  return route;
}
