import { Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, MotionConfig } from 'motion/react';
import type { Access, BookCard } from '@writer/shared/protocol';
import { Header } from './components/Header';
import { IconPlus } from './components/icons';
import { PreviewBar, type AppTheme } from './components/PreviewBar';
import { Toast, type ToastMessage } from './components/Toast';
import { fetchBooks, type Book } from './data/books';
import { pickColor } from './data/colors';
import { PREVIEW_MODES, previewBooks, previewNote, type PreviewMode } from './data/preview';
import { AccountMenu } from './features/account/AccountMenu';
import { LoginDialog } from './features/account/LoginDialog';
import { Gallery } from './features/gallery/Gallery';
import { logOut, refreshMe, useAccount, type AccountState } from './lib/account';
import { OfflineError } from './lib/api';
import { go, useRoute } from './lib/route';
import './app.css';

/**
 * Development only: the preview bar, and the ?preview= and ?theme= links it writes. Production
 * shows only real books.
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

// The setup pages load when they're first opened, so the library doesn't wait for them.
const NewBook = lazy(() => import('./features/setup/NewBook').then((m) => ({ default: m.NewBook })));
const EditSetup = lazy(() => import('./features/setup/EditSetup').then((m) => ({ default: m.EditSetup })));

/** What Google adds to the address when it sends the owner back. */
const RETURN_PARAMS = ['login', 'error'];

/** Why the library shows a note instead of books. */
type NoteKind = Exclude<Access, 'open'> | 'offline' | 'empty';

const NOTES: Record<NoteKind, string> = {
  logged_out: 'Log in with your breader account to write. The writer is invite only for now.',
  unconfirmed: 'Confirm your email first, with the link breader sent you.',
  invite_only: 'The writer is invite only for now.',
  offline: 'The writer is offline right now. It comes back by itself.',
  empty: 'No books yet.',
};

/** What the library shows: nothing while it waits for the server, a note, or the books. */
type Library =
  | { show: 'waiting' }
  | { show: 'note'; note: NoteKind }
  | { show: 'books'; books: Book[] };

function withBooks(books: Book[]): Library {
  if (books.length === 0) return { show: 'note', note: 'empty' };
  return { show: 'books', books };
}

function libraryFor(account: AccountState, books: Book[] | null, booksFailed: boolean, preview: PreviewMode, now: number): Library {
  const note = previewNote(preview);
  if (note) return { show: 'note', note };
  const placeholders = previewBooks(preview, now);
  if (placeholders) return withBooks(placeholders);

  if (account.server === 'down') return { show: 'note', note: 'offline' };
  const access = account.me?.access;
  if (!access) return { show: 'waiting' };
  if (access !== 'open') return { show: 'note', note: access };
  if (booksFailed) return { show: 'note', note: 'offline' };
  if (!books) return { show: 'waiting' };
  return withBooks(books);
}

/** The books with this one first, as it's the most recent: new, or just changed. */
function putFirst(books: Book[] | null, card: BookCard): Book[] | null {
  if (!books) return books;
  const others = books.filter((b) => b.id !== card.id);
  return [card, ...others];
}

/** A quiet note where the books would be: none yet, or why this browser can't write. */
function Note({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div id="library-mine" role="tabpanel" aria-labelledby="tab-mine" className="note">
      <p>{text}</p>
      {children}
    </div>
  );
}

export default function App() {
  const account = useAccount();
  const route = useRoute();
  const [now] = useState(() => Date.now());
  const [preview, setPreview] = useState<PreviewMode>(() => (devTools ? readParam('preview', PREVIEW_MODES.map((m) => m.id), 'live') : 'live'));
  const [theme, setTheme] = useState<AppTheme>(() => (devTools ? readParam('theme', ['auto', 'light', 'dark'] as const, 'auto') : 'auto'));
  const [books, setBooks] = useState<Book[] | null>(null);
  const [booksFailed, setBooksFailed] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastId = useRef(0);

  const say = useCallback((text: string) => {
    toastId.current += 1;
    setToast({ id: toastId.current, text });
  }, []);
  const dismissToast = useCallback((id: number) => setToast((t) => (t?.id === id ? null : t)), []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') delete root.dataset.theme;
    else root.dataset.theme = theme;
    writeParam('theme', theme, 'auto');
  }, [theme]);
  useEffect(() => { writeParam('preview', preview, 'live'); }, [preview]);

  // Back from Google.
  useEffect(() => {
    const url = new URL(window.location.href);
    const login = url.searchParams.get('login');
    if (!login) return;
    RETURN_PARAMS.forEach((k) => url.searchParams.delete(k));
    window.history.replaceState(null, '', url);
    if (login === 'google') say('Logged in.');
    if (login === 'failed') say('Logging in with Google didn’t work. Try again, or use your email and a password.');
  }, [say]);

  // The books load once the server says this account may write, and again when it comes back.
  const canLoad = account.server === 'up' && account.me?.access === 'open';
  useEffect(() => {
    if (!canLoad) {
      setBooks(null);
      return;
    }
    let live = true;
    setBooksFailed(false);
    fetchBooks()
      .then((list) => {
        if (live) setBooks(list);
      })
      .catch((e) => {
        console.warn('Couldn’t load the books:', e);
        if (!live) return;
        setBooksFailed(true);
        // Unreachable: asking who's logged in marks the server down, and it's asked again until it's back.
        if (e instanceof OfflineError) void refreshMe();
      });
    return () => { live = false; };
  }, [canLoad]);

  const openLogin = useCallback(() => setLoginOpen(true), []);
  const onLoggedIn = useCallback(() => {
    setLoginOpen(false);
    say('Logged in.');
  }, [say]);
  const onLogOut = useCallback(async () => {
    await logOut();
    say('Logged out.');
  }, [say]);
  const newBook = useCallback(() => go({ page: 'new' }), []);
  const toLibrary = useCallback(() => go({ page: 'library' }), []);
  // Playing comes in a later step; until then a card opens what its book was set up with.
  const onOpen = useCallback((b: Book) => go({ page: 'setup', bookId: b.id }), []);
  const onMade = useCallback((card: BookCard) => {
    setBooks((list) => putFirst(list, card));
    go({ page: 'library' });
    say(`Made “${card.title}”.`);
  }, [say]);
  const onSaved = useCallback((card: BookCard) => {
    setBooks((list) => putFirst(list, card));
    go({ page: 'library' });
    say('Saved.');
  }, [say]);

  const library = libraryFor(account, books, booksFailed, preview, now);
  let count = 0;
  let onNew: (() => void) | undefined = undefined;
  if (library.show === 'books') {
    count = library.books.length;
    onNew = newBook;
  }

  // Setting up a book is for accounts that can write; anyone else sees the library and its note.
  const canWrite = account.me?.access === 'open';
  let page: ReactNode;
  if (route.page === 'new' && canWrite) {
    const given = (books ?? []).map((b) => b.color);
    page = <NewBook color={pickColor(given)} onMade={onMade} onClose={toLibrary} />;
  } else if (route.page === 'setup' && canWrite) {
    page = <EditSetup key={route.bookId} bookId={route.bookId} onSaved={onSaved} onClose={toLibrary} />;
  } else {
    page = (
      <div className="lib">
        <Header count={count} onNew={onNew} account={<AccountMenu account={account} onLogin={openLogin} onLogOut={onLogOut} />} />
        {library.show === 'books' && (
          <Gallery books={library.books} now={now} id="library-mine" labelledBy="tab-mine" onOpen={onOpen} />
        )}
        {library.show === 'note' && (
          <Note text={NOTES[library.note]}>
            {library.note === 'logged_out' && (
              <button type="button" className="btn btn-primary note-action" onClick={openLogin}>Log in</button>
            )}
            {library.note === 'empty' && (
              <button type="button" className="btn btn-primary note-action" onClick={newBook}>
                <IconPlus /> New book
              </button>
            )}
          </Note>
        )}
      </div>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <Suspense fallback={null}>{page}</Suspense>

      <AnimatePresence>
        {loginOpen && <LoginDialog key="login" google={account.google} onDone={onLoggedIn} onClose={() => setLoginOpen(false)} />}
      </AnimatePresence>

      <Toast toast={toast} onDone={dismissToast} />
      {devTools && <PreviewBar mode={preview} onMode={setPreview} theme={theme} onTheme={setTheme} />}
    </MotionConfig>
  );
}
