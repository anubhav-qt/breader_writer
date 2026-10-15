import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BookView } from '@writer/shared/reading';
import { IconDownload } from '../../components/icons';
import { failureText } from '../../lib/api';
import { epubUrl, fetchBook, keepPlace, placeIn, seeChapters } from '../../data/book';
import type { Loc, Start } from './FlowView';
import { Reader } from './Reader';
import { useReaderSettings } from './settings';
import type { FlowBook, Section, TocItem } from './types';
import './reader.css';
import './instrument.css';

/*
 * The book as it's written (step 7), a tap away from the play: breader's reader on the chapters
 * written so far. The book trails the play, so the page says what's still being written, and asks
 * again while it is. The place is kept in this browser.
 */

interface Props {
  bookId: string;
  onBack: () => void;
}

type Loaded =
  | { state: 'loading' }
  | { state: 'failed'; message: string }
  | { state: 'loaded'; view: BookView };

/** How often to look for a chapter while one is being written, and while one waits that isn't. */
const WRITING_MS = 5_000;
const WAITING_MS = 60_000;

function escaped(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A chapter's prose as the page shows it: its number and title as headings, then its paragraphs. */
function chapterHtml(number: number, title: string, body: string): string {
  const parts = [`<h1>Chapter ${number}</h1>`];
  if (title.trim() !== '') {
    parts.push(`<h2>${escaped(title.trim())}</h2>`);
  }
  for (const paragraph of body.split(/\n\s*\n/)) {
    const text = paragraph.trim().replace(/\s*\n\s*/g, ' ');
    if (text !== '') {
      parts.push(`<p>${escaped(text)}</p>`);
    }
  }
  return parts.join('');
}

/** What's still to come, said after the last chapter and under the contents. Empty when nothing is. */
function comingText(view: BookView): string {
  const next = view.waiting[0];
  if (next !== undefined && view.writing) {
    return `Chapter ${next} is being written.`;
  }
  if (next !== undefined) {
    return `Chapter ${next} isn’t written yet. It’s tried again in a while.`;
  }
  if (view.finished) {
    return 'The end.';
  }
  return 'The story goes on. Each scene joins the book once you’ve gone on from it.';
}

/** The chapters as breader's reader takes a book: a section each, and the contents. */
function flowBookOf(view: BookView): FlowBook {
  const sections: Section[] = [];
  const toc: TocItem[] = [];
  let words = 0;
  view.chapters.forEach((chapter, i) => {
    let html = chapterHtml(chapter.number, chapter.title, chapter.body);
    if (i === view.chapters.length - 1) {
      html += `<p class="fv-end">${escaped(comingText(view))}</p>`;
    }
    let title = chapter.title.trim();
    if (title === '') {
      title = `Chapter ${chapter.number}`;
    }
    sections.push({ title, html, words: chapter.words });
    toc.push({ title, section: i, level: 0 });
    words += chapter.words;
  });
  return { kind: 'flow', title: view.title, author: view.author, sections, toc, words };
}

/** Where the book opens: where the owner left it, or its start. */
function startOf(bookId: string): Start {
  const place = placeIn(bookId);
  if (place) {
    return { kind: 'pos', pos: place.pos };
  }
  return { kind: 'fraction', value: 0 };
}

export function BookPage({ bookId, onBack }: Props) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [start] = useState<Start>(() => startOf(bookId));

  const load = useCallback(async () => {
    try {
      const view = await fetchBook(bookId);
      setLoaded({ state: 'loaded', view });
      seeChapters(bookId, view.chapters.length);
    } catch (e) {
      // A failure while the book is open leaves it as it was; only the first one shows.
      setLoaded((was) => {
        if (was.state === 'loaded') {
          return was;
        }
        return { state: 'failed', message: failureText(e) };
      });
    }
  }, [bookId]);

  useEffect(() => {
    void load();
  }, [load]);

  // While a chapter is on its way, look for it now and then.
  const view = loaded.state === 'loaded' ? loaded.view : null;
  let every = 0;
  if (view && view.writing) {
    every = WRITING_MS;
  } else if (view && view.waiting.length > 0) {
    every = WAITING_MS;
  }
  useEffect(() => {
    if (every === 0) {
      return;
    }
    const timer = window.setTimeout(() => void load(), every);
    return () => window.clearTimeout(timer);
  }, [every, view, load]);

  const book = useMemo(() => {
    if (!view || view.chapters.length === 0) {
      return null;
    }
    return flowBookOf(view);
  }, [view]);

  const onPlace = useCallback((loc: Loc) => {
    keepPlace(bookId, { pos: { section: loc.section, block: loc.block, offset: loc.offset }, progress: loc.progress, line: loc.line });
  }, [bookId]);

  if (!view || !book) {
    return <NoBook loaded={loaded} onBack={onBack} />;
  }

  // Under the contents, what's still to come; a finished book needs no line saying so.
  let coming = comingText(view);
  if (view.finished && view.waiting.length === 0) {
    coming = '';
  }
  const contentsEnd = (
    <>
      {coming && <p className="p-coming">{coming}</p>}
      <a className="p-down" href={epubUrl(bookId)} download>
        <IconDownload /> Download as EPUB
      </a>
    </>
  );

  return <Reader book={book} color={view.color} start={start} onBack={onBack} onPlace={onPlace} contentsEnd={contentsEnd} />;
}

/** Nothing to read yet: the book is loading, couldn't be read, or has no chapters. */
function NoBook({ loaded, onBack }: { loaded: Loaded; onBack: () => void }) {
  const [settings] = useReaderSettings();
  let text = '';
  if (loaded.state === 'failed') {
    text = loaded.message;
  } else if (loaded.state === 'loaded' && loaded.view.waiting.length > 0) {
    text = comingText(loaded.view);
  } else if (loaded.state === 'loaded') {
    text = 'Nothing’s in the book yet. Each scene joins it once you’ve gone on from it.';
  }
  return (
    <div className={`rd t-${settings.theme} st-book`}>
      <div className="rd-body">
        <div className="rd-chrome">
          <div className="i3-head is-on bk-head">
            <button type="button" className="i3-side" onClick={onBack} aria-label="Back to the play">‹<span className="i3-back-word"> Play</span></button>
          </div>
        </div>
        {text && <p className="bk-none">{text}</p>}
      </div>
    </div>
  );
}
