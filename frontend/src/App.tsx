import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { animate } from 'motion';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react';
import { Header, type Tab } from './components/Header';
import { PreviewBar, type AppTheme } from './components/PreviewBar';
import { Toast, type ToastMessage } from './components/Toast';
import { coverOf, detectFormat, forget, loadRecord, parseSource, titleFromName } from './books/load';
import { recordFromBook } from './books/record';
import type { BookEdit, BookRecord, LoadedBook, ReadState } from './books/types';
import { normColor } from './data/colors';
import { canRemove, canShare, mixedCovers, mixedRecords, placeholderRecords, PREVIEW_MODES, sampleRecords, seriesRecords, shelfRecords, type PreviewMode } from './data/library';
import { KEEP_WORDS } from '@breader/shared/limits';
import type { AccountResponse } from '@breader/shared/protocol';
import { shelfRecord, useShelf } from './data/shelf';
import { flush, openWithKey } from './data/sync';
import { useLibrary, withReading, type ShelfItem } from './data/useLibrary';
import { AddBook } from './features/add/AddBook';
import { KeyDialog } from './features/add/KeyDialog';
import { AccountMenu } from './features/account/AccountMenu';
import { LoginDialog, type LoginStart } from './features/account/LoginDialog';
import { Gallery } from './features/gallery/Gallery';
import { RemoveDialog } from './features/gallery/RemoveDialog';
import { detectSeries, seriesNames } from './features/gallery/series';
import { fillGaps, genreFor } from './features/gallery/fill';
import { Reader } from './features/reader/Reader';
import { loginError, logOut, refreshAccount, useAccount, verifyEmail } from './lib/account';
import { api } from './lib/api';
import { newLibraryKey } from './lib/key';
import { springs } from './lib/springs';
import { readLocal } from './lib/store';
import './app.css';

type Route = { name: 'library' } | { name: 'read'; id: string };

function parseHash(): Route {
  const m = window.location.hash.match(/^#\/read\/(.+)$/);
  return m ? { name: 'read', id: decodeURIComponent(m[1]) } : { name: 'library' };
}

/**
 * Development only: the preview bar, the ?preview= and ?theme= links it writes, and the placeholder
 * books on the shared shelf. Production shows only real books.
 */
const devTools = import.meta.env.DEV;

function readParam<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const v = new URLSearchParams(window.location.search).get(name) as T | null;
  return v && allowed.includes(v) ? v : fallback;
}

function writeParam(name: string, value: string, fallback: string) {
  const url = new URL(window.location.href);
  if (value === fallback) url.searchParams.delete(name);
  else url.searchParams.set(name, value);
  window.history.replaceState(null, '', url);
}

const byRecent = (a: ShelfItem, b: ShelfItem) => b.lastOpened - a.lastOpened;

/** Links that bring the reader back to the app: from Google, and from Breader's emails. */
const RETURN_PARAMS = ['login', 'error', 'verify', 'reset'];

const WELCOME: Record<AccountResponse['outcome'], string> = {
  adopted: 'Logged in. Your books are saved to your account.',
  created: 'Logged in. Books you add are saved to your account.',
  opened: 'Logged in. Here are your account’s books.',
  claimed: 'Logged in. This browser’s books are in your account now.',
  switched: 'Logged in. The other books stay under their own key.',
  same: 'Logged in.',
  choose: 'Logged in.',
};
const inset = (r: DOMRect) =>
  `inset(${r.top}px ${window.innerWidth - r.right}px ${window.innerHeight - r.bottom}px ${r.left}px round 20px)`;
const FULL = 'inset(0px 0px 0px 0px round 0px)';

/** Where a book's card is in the library, as it will settle (the library may still be rising in). */
function cardRect(id: string): DOMRect | null {
  const tile = document.querySelector<HTMLElement>(`.gallery:not([hidden]) .tile-hit[data-id="${CSS.escape(id)}"]`)?.parentElement;
  if (!tile) return null;
  const r = tile.getBoundingClientRect();
  const slot = tile.closest<HTMLElement>('.tile-slot');
  const t = slot ? getComputedStyle(slot).transform : 'none';
  const dy = t && t !== 'none' ? new DOMMatrixReadOnly(t).m42 : 0;
  const top = r.top - dy;
  if (r.width < 8 || top >= window.innerHeight || top + r.height <= 0) return null;
  return new DOMRect(r.left, top, r.width, r.height);
}

/** The reader goes back into its card: its text clears, then the page draws back into the card. */
async function closeReader(host: HTMLElement, id: string, reduced: boolean) {
  if (reduced) { await animate(host, { opacity: 0 }, { duration: 0.15 }); return; }
  const r = cardRect(id);
  if (!r) { await animate(host, { opacity: 0, scale: 0.98 }, { duration: 0.3 }); return; }
  const content = Array.from(host.querySelectorAll<HTMLElement>('.rd-body'));
  await Promise.all([
    animate(host, { opacity: [1, 1, 0] }, { duration: 0.62, times: [0, 0.72, 1] }),
    ...content.map((el) => animate(el, { opacity: 0 }, { duration: 0.16 })),
    animate(host, { clipPath: [FULL, inset(r)] }, springs.snappy),
  ]);
}

export default function App() {
  // Notices from sync (a file the server wouldn't take) use the toast below.
  const lib = useLibrary({ onNotice: (text) => say(text) });
  const shelf = useShelf();
  const [now] = useState(() => Date.now());
  const [route, setRoute] = useState<Route>(parseHash);
  const [tab, setTab] = useState<Tab>('mine');
  // Each tab's library stays once it's been seen, so switching back finds it as it was.
  const [seen, setSeen] = useState<ReadonlySet<Tab>>(() => new Set([tab]));
  if (!seen.has(tab)) setSeen(new Set([...seen, tab]));
  const [preview, setPreview] = useState<PreviewMode>(() => (devTools ? readParam('preview', PREVIEW_MODES.map((m) => m.id), 'live') : 'live'));
  const [theme, setTheme] = useState<AppTheme>(() => (devTools ? readParam('theme', ['auto', 'light', 'dark'] as const, 'auto') : 'auto'));
  const [adding, setAdding] = useState<{ file?: File | null; mode?: 'file' | 'paste' } | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  /** A book in both places being removed from one: asking whether it leaves the other too. */
  const [asking, setAsking] = useState<{ id: string; title: string; from: Tab; fromKeyboard: boolean; then?: () => void } | null>(null);
  const [login, setLogin] = useState<LoginStart | null>(null);
  const account = useAccount();
  const [dragOver, setDragOver] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  /* Books removed this session, kept out of every view (previews show copies of stored books). */
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [opening, setOpening] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [closing, setClosing] = useState<{ id: string } | null>(null);
  const reduced = useReducedMotion() ?? false;
  const hostRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<{ id: string; book: LoadedBook } | null>(null);
  const openAnimDone = useRef(false);
  const loadedId = useRef<string | null>(null);
  const toastId = useRef(0);

  const say = useCallback((text: string, more?: Omit<ToastMessage, 'id' | 'text'>) => {
    setToast({ id: ++toastId.current, text, ...more });
  }, []);
  const dismissToast = useCallback((id: number) => setToast((t) => (t?.id === id ? null : t)), []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') delete root.dataset.theme;
    else root.dataset.theme = theme;
    writeParam('theme', theme, 'auto');
  }, [theme]);
  useEffect(() => { writeParam('preview', preview, 'live'); }, [preview]);

  // Back from Google, or from a link in one of Breader's emails.
  useEffect(() => {
    const url = new URL(window.location.href);
    const q = Object.fromEntries(RETURN_PARAMS.map((k) => [k, url.searchParams.get(k)]));
    if (!q.login && !q.verify && !q.reset) return;
    RETURN_PARAMS.forEach((k) => url.searchParams.delete(k));
    window.history.replaceState(null, '', url);
    if (q.reset) setLogin({ mode: 'reset', token: q.reset });
    else if (q.login === 'google') setLogin({ mode: 'entering' });
    else if (q.login === 'failed') say('Logging in with Google didn’t work. Try again, or use your email and a password.');
    else if (q.verify) {
      const token = q.verify;
      void (async () => {
        try {
          const before = await refreshAccount();
          const after = await verifyEmail(token);
          say('Your email is confirmed.');
          // The link logs in a browser that wasn't: that browser moves to the account's library too.
          if (before.status !== 'in' && after.status === 'in') setLogin({ mode: 'entering' });
        } catch (e) {
          say(loginError(e));
        }
      })();
    }
  }, [say]);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  /* Data for the current view */
  const previewSets = useMemo(
    () => (devTools
      ? { all: [...sampleRecords(now), ...placeholderRecords(now)], series: seriesRecords(now), shelf: shelfRecords(now), mixed: mixedRecords(now), covers: mixedCovers() }
      : { all: [], series: [], shelf: [], mixed: [], covers: {} }),
    [now],
  );
  /*
   * The Shared Library tab: this reader's own shared books, then everyone else's. A shared book they
   * have started shows as their copy of it, with their place and colour.
   */
  const sharedRecords = useMemo(() => {
    const own = lib.records.filter((r) => r.shared);
    const ownIds = new Set(own.map((r) => r.id));
    const copies = new Map<string, BookRecord>();
    for (const r of lib.records) if (r.origin && !hidden.has(r.id)) copies.set(r.origin, r);
    const others = shelf.books.filter((b) => !ownIds.has(b.id)).map((b) => copies.get(b.id) ?? shelfRecord(b));
    return [...own, ...others];
  }, [lib.records, shelf.books, hidden]);

  /*
   * Copies of shared books read too little of to keep (KEEP_WORDS) whose owner made them private.
   * A library on the server hears which from it; one without a key goes by the Shared Library list.
   */
  const lapsed = useMemo(() => {
    if (lib.key || !shelf.complete) return lib.lapsed;
    const listed = new Set(shelf.books.map((b) => b.id));
    return new Set(lib.records.filter((r) => r.origin && !listed.has(r.origin) && (lib.reads[r.id]?.wordsRead ?? 0) < KEEP_WORDS).map((r) => r.id));
  }, [lib.key, lib.lapsed, lib.records, lib.reads, shelf.books, shelf.complete]);

  const recordById = useMemo(() => {
    const m = new Map<string, BookRecord>();
    for (const r of [...previewSets.all, ...previewSets.mixed, ...previewSets.shelf, ...sharedRecords, ...lib.records]) m.set(r.id, r);
    // The series preview places some of the same books differently; it wins while it's showing.
    if (preview === 'series') for (const r of previewSets.series) m.set(r.id, r);
    return m;
  }, [previewSets, sharedRecords, lib.records, preview]);

  const items = useMemo(() => {
    const covers = { ...previewSets.covers, ...shelf.covers, ...lib.covers };
    const view = (recs: BookRecord[]) =>
      recs.filter((r) => !hidden.has(r.id)).map((r) => withReading(r, lib.reads, covers, lib.edits)).sort(byRecent);
    const liveMine = view(lib.records.filter((r) => !lapsed.has(r.id) && !r.sharedOnly));
    // A copy stands where its shared book stood, so its card stays put when it's started.
    const onShelf = view([...sharedRecords, ...previewSets.shelf]).map((b) => (b.origin ? { ...b, key: b.origin } : b));
    let mine: ShelfItem[];
    switch (preview) {
      case 'empty': mine = []; break;
      case 'one': mine = liveMine.slice(0, 1).length ? liveMine.slice(0, 1) : view(previewSets.all).slice(0, 1); break;
      case 'few': mine = view(previewSets.all).slice(0, 6); break;
      case 'many': mine = view(previewSets.all); break;
      case 'series': mine = view(previewSets.series); break;
      case 'mixed': mine = view(previewSets.mixed); break;
      default: mine = liveMine;
    }
    // Blank series, numbers and genres filled in from the rest of both libraries, and one name a series.
    const filled = fillGaps([...mine, ...onShelf]);
    return { mine: filled.slice(0, mine.length), shelf: filled.slice(mine.length) };
  }, [lib.records, lib.reads, lib.covers, lib.edits, lapsed, shelf.covers, sharedRecords, previewSets, preview, hidden]);
  const allSeries = useMemo(() => seriesNames([...items.mine, ...items.shelf]), [items]);
  const guessGenre = useCallback((b: Parameters<typeof genreFor>[1]) => genreFor([...items.mine, ...items.shelf], b), [items]);

  /* Opening a book: the reader grows out of the card, then takes over. */
  const finishOpen = useCallback((id: string) => {
    window.location.hash = `#/read/${encodeURIComponent(id)}`;
    setOpening(null);
  }, []);

  const startLoad = useCallback(async (id: string, given?: BookRecord) => {
    const rec = given ?? recordById.get(id);
    if (!rec) return null;
    try {
      const book = await loadRecord(rec);
      loadedId.current = id;
      setLoaded({ id, book });
      // Books added before they had a cover get one the first time they open.
      if (!rec.hasCover && rec.source === 'file') {
        void coverOf(book).then((cover) => { if (cover) void lib.setCover(id, cover); });
      }
      return book;
    } catch (e) {
      console.error(e);
      say(e instanceof Error ? e.message : 'Couldn’t open this book.');
      return null;
    }
  }, [recordById, lib, say]);

  const onOpen = useCallback(async (book: ShelfItem, rect: DOMRect) => {
    openAnimDone.current = false;
    loadedId.current = null;
    // A shared book this reader hasn't started joins their library as they open it.
    const entry = recordById.get(book.id);
    const rec = entry?.source === 'shelf' ? await lib.startShelfBook(entry) : entry;
    if (!rec) return;
    // One taken out of My books comes back in once it's being read again.
    if (rec.sharedOnly) lib.setSharedOnly(rec.id, false);
    setOpening({ id: rec.id, rect });
    void startLoad(rec.id, rec).then((b) => {
      if (!b) setOpening(null);
      else if (openAnimDone.current) finishOpen(rec.id);
    });
  }, [recordById, lib, startLoad, finishOpen]);

  /** Renaming, recolouring or favouring a shared book adds it to the reader's library first. */
  const editBook = useCallback(async (id: string, patch: BookEdit) => {
    const rec = recordById.get(id);
    lib.editBook(rec?.source === 'shelf' ? (await lib.startShelfBook(rec)).id : id, patch);
  }, [recordById, lib]);

  // A reader URL opened directly (or reloaded) loads without the transition.
  useEffect(() => {
    if (route.name === 'read' && loaded?.id !== route.id && !opening && lib.ready) void startLoad(route.id);
  }, [route, loaded, opening, lib.ready, startLoad]);

  const back = useCallback(() => {
    if (route.name === 'read' && loadedId.current === route.id) setClosing({ id: route.id });
    window.location.hash = '';
    setRoute({ name: 'library' });
  }, [route]);

  // Closing waits two frames, so the library underneath has laid out the card to land on.
  useEffect(() => {
    if (!closing) return;
    let live = true;
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        const host = hostRef.current;
        void (host ? closeReader(host, closing.id, reduced) : Promise.resolve()).then(() => {
          if (!live) return;
          // Gone before its styles are undone, or it shows whole for a frame over the library.
          flushSync(() => setClosing(null));
          if (!host?.isConnected) return;
          host.removeAttribute('style');
          host.querySelectorAll<HTMLElement>('.rd-body').forEach((el) => { el.style.opacity = ''; });
        });
      });
    });
    return () => { live = false; cancelAnimationFrame(raf); };
  }, [closing, reduced]);

  const onSave = useCallback((read: ReadState) => {
    if (route.name !== 'read') return;
    const rec = recordById.get(route.id);
    if (rec?.source === 'placeholder') lib.saveRead(route.id, { ...(lib.reads[route.id] ?? { progress: rec.progress, line: rec.line }), lastOpened: read.lastOpened });
    else lib.saveRead(route.id, read);
  }, [route, recordById, lib]);

  /* Removing a book takes it out of every view at once, with a few seconds to undo. */
  const removeBook = useCallback(async (id: string, fromKeyboard = false) => {
    const rec = recordById.get(id);
    if (!rec) return;
    const title = lib.edits[id]?.title?.trim() || rec.title;
    forget(id);
    const removed = lib.records.some((r) => r.id === id) ? await lib.removeBook(id) : null;
    setHidden((h) => new Set(h).add(id));
    const undo = async () => {
      // Focus on the toast (or nowhere) would be lost with it, so it goes to the card that came back.
      const a = document.activeElement;
      const refocus = !a || a === document.body || !!a.closest('.toast-host');
      if (removed) await lib.restoreBook(removed);
      setHidden((h) => {
        const next = new Set(h);
        next.delete(id);
        return next;
      });
      if (refocus) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          document.querySelector<HTMLElement>(`.gallery:not([hidden]) .tile-hit[data-id="${CSS.escape(id)}"]`)?.focus();
        }));
      }
    };
    say(`Removed “${title}”`, { action: { label: 'Undo', run: () => void undo() }, focus: fromKeyboard });
  }, [recordById, lib, say]);

  /** Removes a book, first asking about the other place when it's in both the reader's books and the Shared Library. */
  const askRemove = useCallback((id: string, fromKeyboard = false, then?: () => void) => {
    const rec = lib.records.find((r) => r.id === id);
    const title = (rec && lib.edits[id]?.title?.trim()) || rec?.title || '';
    if (rec && canShare(rec) && rec.shared && !rec.sharedOnly) {
      setAsking({ id, title, from: tab, fromKeyboard, then });
      return;
    }
    // Someone else's shared book, started here: out of My books, it stays on the Shared Library with
    // the reader's place in it, for when they come back to it.
    if (rec?.origin && !rec.sharedOnly && tab === 'mine' && shelf.books.some((b) => b.id === rec.origin)) {
      lib.setSharedOnly(id, true);
      say(`Took “${title}” out of your books. It stays on the Shared Library, and so does your place in it.`, { action: { label: 'Undo', run: () => lib.setSharedOnly(id, false) }, focus: fromKeyboard });
      then?.();
      return;
    }
    void removeBook(id, fromKeyboard).then(then);
  }, [lib, tab, shelf.books, removeBook, say]);

  const chooseRemove = useCallback((both: boolean) => {
    if (!asking) return;
    const { id, title, from, fromKeyboard, then } = asking;
    setAsking(null);
    if (both) void removeBook(id, fromKeyboard);
    else if (from === 'mine') {
      lib.setSharedOnly(id, true);
      say(`Took “${title}” out of your books. It stays on the Shared Library.`, { action: { label: 'Undo', run: () => lib.setSharedOnly(id, false) }, focus: fromKeyboard });
    } else {
      lib.setShared(id, false);
      say(`Took “${title}” off the Shared Library. It stays in your books.`, { action: { label: 'Undo', run: () => lib.setShared(id, true) }, focus: fromKeyboard });
    }
    then?.();
  }, [asking, lib, removeBook, say]);

  const removeOpen = useCallback(() => {
    if (route.name === 'read') askRemove(route.id, false, back);
  }, [route, askRemove, back]);

  /* Drop files anywhere on the library and they're added straight to the tab you're on. */
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const addFiles = useCallback(async (files: File[]) => {
    const shared = tabRef.current === 'shelf';
    let needKey = !lib.key;
    for (const file of files) {
      const format = detectFormat(file);
      if (!format) { say(`Breader can’t open “${file.name}”`); continue; }
      try {
        const book = await parseSource(file, format, titleFromName(file.name));
        const rec = recordFromBook(book, format, shared, lib.nextColor());
        // What the Add a book dialog would have filled in, taken as it is.
        const found = detectSeries(book.title, file.name, book.kind === 'flow' ? book.series : undefined, allSeries);
        if (found) Object.assign(rec, { series: found.name, seriesIndex: found.index });
        const genre = guessGenre({ author: rec.author, series: found?.name, subjects: book.kind === 'flow' ? book.subjects : undefined });
        if (genre) rec.genre = genre;
        const cover = await coverOf(book);
        book.cleanup?.();
        await lib.addBook(rec, file, cover);
        setPreview('live');
        say(`Added “${rec.title}”`);
        // A key gives the book somewhere on the server to go: to sync, and to reach the Shared Library.
        if (needKey) {
          const key = newLibraryKey();
          await lib.setKey(key);
          setFreshKey(key);
          needKey = false;
        }
      } catch (e) {
        console.error(e);
        say(`Breader couldn’t read “${file.name}”`);
      }
    }
  }, [lib, say, allSeries, guessGenre]);

  useEffect(() => {
    if (route.name !== 'library') return;
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => { if (!hasFiles(e) || adding) return; e.preventDefault(); depth++; setDragOver(true); };
    const over = (e: DragEvent) => { if (hasFiles(e) && !adding) e.preventDefault(); };
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setDragOver(false); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e) || adding) return;
      e.preventDefault();
      depth = 0;
      setDragOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) void addFiles(files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [route.name, adding, addFiles]);

  const onAdded = useCallback(async (rec: BookRecord, data: Blob | string, cover?: Blob, opts?: { ai: boolean }) => {
    await lib.addBook(rec, data, cover);
    if (opts?.ai) lib.editBook(rec.id, { ai: true });
    setPreview('live');
    setTab(rec.shared ? 'shelf' : 'mine');
    say(`Added “${rec.title}” to ${rec.shared ? 'the Shared Library' : 'My books'}`);
  }, [lib, say]);

  /* The Key dialog's "Open library": this browser switches to the library behind that key. */
  const openKey = useCallback(async (key: string) => {
    await openWithKey(key);
    setPreview('live');
    setTab('mine');
    say('Opened the library for that key');
  }, [say]);

  /*
   * Logged in, with no library in this browser: a phone's home-screen app, which starts with the
   * login Safari had and none of its storage, or a browser that cleared its storage. It opens the
   * account's library quietly, as logging in would have; offline, it tries again next time.
   */
  const rejoined = useRef(false);
  const { ready: libReady, key: libKey, joinAccount } = lib;
  useEffect(() => {
    if (rejoined.current || account.status !== 'in' || !libReady || libKey || login) return;
    rejoined.current = true;
    void joinAccount().then((res) => { if (res.outcome === 'choose') setLogin({ mode: 'entering' }); }, () => {});
  }, [account.status, libReady, libKey, joinAccount, login]);

  const loggedIn = account.status === 'in';
  const onLoggedIn = useCallback((res: AccountResponse) => {
    setLogin(null);
    setPreview('live');
    setTab('mine');
    say(WELCOME[res.outcome]);
  }, [say]);

  /** Logs out and clears this browser: the books stay in the account, not here. */
  const logOutAll = useCallback(async () => {
    await flush();
    await logOut();
    await api.del('/v1/session').catch(() => {});
    await lib.reset();
  }, [lib]);

  /** From a new key's dialog: log in instead. */
  const loginInstead = useCallback(() => {
    setFreshKey(null);
    setAdding(null);
    setKeyOpen(false);
    setLogin({ mode: 'login' });
  }, []);

  const reading = route.name === 'read' && loaded?.id === route.id ? loaded : null;
  // A reader on its way back into its card stays on screen until it gets there.
  const leaving = !reading && closing && loaded?.id === closing.id ? loaded : null;
  const shown = reading ?? leaving;
  const shownRec = shown ? recordById.get(shown.id) : undefined;
  const books = tab === 'mine' ? items.mine : items.shelf;

  return (
    <MotionConfig reducedMotion="user">
      {route.name === 'library' && (
        <div className="lib">
          <Header
            tab={tab}
            counts={{ mine: items.mine.length, shelf: items.shelf.length }}
            canAdd={books.length > 0}
            onTab={setTab}
            onAdd={() => setAdding({ mode: 'file' })}
            onKey={() => setKeyOpen(true)}
            account={<AccountMenu account={account} onLogin={() => setLogin({ mode: 'login' })} onLogOut={logOutAll} />}
          />
          {lib.ready && (['mine', 'shelf'] as const).filter((t) => seen.has(t)).map((t) => (
            <Gallery
              key={`${t}-${preview}`}
              books={t === 'mine' ? items.mine : items.shelf}
              seriesNames={allSeries}
              place={t}
              // The Shared Library is browsed by genre; one's own books, by series.
              view={t === 'shelf' ? 'genre' : 'series'}
              now={now}
              id={`library-${t}`}
              labelledBy={`tab-${t}`}
              hidden={t !== tab}
              onOpen={(b, rect) => void onOpen(b, rect)}
              onAdd={() => setAdding({ mode: 'file' })}
              onEdit={(id, patch) => void editBook(id, patch)}
              onFinish={(b, finished) => lib.setFinished(b.id, finished, b)}
              onRemove={(b, fromKeyboard) => askRemove(b.id, fromKeyboard)}
              onShare={(b, shared) => {
                // Out of their books already: off the Shared Library too, it's nowhere, so it goes.
                if (!shared && b.sharedOnly) { void removeBook(b.id); return; }
                lib.setShared(b.id, shared);
                say(shared ? `“${b.title}” is on the Shared Library` : `Took “${b.title}” off the Shared Library. Anyone well into it keeps it.`);
              }}
            />
          ))}
        </div>
      )}

      {shown && shownRec && (
        <div className={`rd-host${leaving ? ' is-leaving' : ''}`} ref={hostRef}>
          <Reader
            key={shown.id}
            record={shownRec}
            title={lib.edits[shown.id]?.title}
            color={normColor(lib.edits[shown.id]?.color ?? shownRec.color, shownRec.title)}
            book={shown.book}
            initial={lib.reads[shown.id]}
            closing={!!leaving}
            onBack={back}
            onSave={onSave}
            onReadTime={(seconds) => lib.addReadTime(shown.id, seconds)}
            onRemove={canRemove(shownRec) ? removeOpen : undefined}
            ai={!!lib.edits[shown.id]?.ai}
          />
        </div>
      )}
      {route.name === 'read' && !reading && !opening && (
        <div className="loading"><span className="add-spinner" /> Opening…</div>
      )}

      <AnimatePresence>
        {opening && (
          <motion.div
            key="opening"
            className={`opening t-${readLocal<{ theme?: string }>('breader.reader.v1', {}).theme ?? 'auto'}`}
            initial={{ clipPath: inset(opening.rect) }}
            animate={{ clipPath: FULL }}
            exit={{ opacity: 0, transition: { duration: 0.16 } }}
            transition={springs.snappy}
            onAnimationComplete={() => {
              openAnimDone.current = true;
              if (loadedId.current === opening.id) finishOpen(opening.id);
            }}
          >
            {loaded?.id !== opening.id && <span className="opening-note"><span className="add-spinner" /> Opening…</span>}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {dragOver && (
          <motion.div key="drop" className="drop-over" aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {adding && (
          <AddBook
            key="add"
            initialFile={adding.file}
            initialMode={adding.mode}
            hasKey={!!lib.key}
            nextColor={lib.nextColor}
            defaultShared={tab === 'shelf'}
            knownSeries={allSeries}
            genreFor={guessGenre}
            onClose={() => setAdding(null)}
            onAdded={onAdded}
            onKey={lib.setKey}
            onLogin={loggedIn ? undefined : loginInstead}
          />
        )}
        {asking && <RemoveDialog key="remove" title={asking.title} from={asking.from} onChoose={chooseRemove} onClose={() => setAsking(null)} />}
        {keyOpen && <KeyDialog key="key" libraryKey={lib.key} loggedIn={loggedIn} onClose={() => setKeyOpen(false)} onOpen={openKey} />}
        {freshKey && <KeyDialog key="fresh-key" libraryKey={freshKey} fresh onLogin={loggedIn ? undefined : loginInstead} onClose={() => setFreshKey(null)} />}
        {login && (
          <LoginDialog
            key="login"
            start={login}
            google={account.google}
            ready={lib.ready}
            localKey={lib.key}
            enter={lib.joinAccount}
            onDone={onLoggedIn}
            onClose={() => setLogin(null)}
          />
        )}
      </AnimatePresence>

      <Toast toast={toast} onDone={dismissToast} />
      {devTools && route.name === 'library' && (
        <PreviewBar mode={preview} onMode={setPreview} theme={theme} onTheme={setTheme} onReset={() => void lib.reset()} />
      )}
    </MotionConfig>
  );
}
