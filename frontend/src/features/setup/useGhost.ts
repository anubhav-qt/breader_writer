import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
  type SyntheticEvent,
  type UIEvent,
} from 'react';
import type { BookSetup } from '@writer/shared/book';
import { filledIn, SUGGEST_AFTER, type FieldAsk, type FieldRef } from '@writer/shared/suggestions';
import { suggestFor } from '../../data/suggestions';

/*
 * Procreator's suggestion in the setup field clicked into (step 5): faint text after what's
 * written there, made from everything on the page. Tab or the right arrow key takes it, and so
 * does a tap on it, since a phone has neither key. Typing anything else clears it.
 *
 * A field can't colour part of its own text, so the faint text is drawn in a mirror: a copy of
 * the field's box laid over it, with the field's text invisible and the suggestion after it.
 */

/** How long a field is in focus before Procreator is asked, so tabbing past a field asks nothing. */
const ASK_AFTER = 400;

type Box = HTMLInputElement | HTMLTextAreaElement;

/** What the setup page tells its fields: the page as it stands, and the book once it's made. */
export interface SetupHelp {
  setup: BookSetup;
  bookId: string | null;
}

/** Given by the setup page around its fields. A field anywhere else gets no suggestions. */
export const HelpContext = createContext<SetupHelp | null>(null);

/** A suggestion on its way, and the field's text it goes after. */
interface Asking {
  ask: FieldAsk;
  value: string;
}

/** The faint text, and the field's text it goes after. */
interface Ghost {
  text: string;
  after: string;
}

export interface Ghosting {
  /** The faint text to show after the field's text, or '' when there's none. */
  shown: string;
  /** The field calls this as it's typed in, before its own change: typing clears the faint text. */
  typed: () => void;
  boxRef: (box: Box | null) => void;
  mirrorRef: RefObject<HTMLDivElement | null>;
  boxProps: {
    onFocus: (e: FocusEvent<Box>) => void;
    onBlur: (e: FocusEvent<Box>) => void;
    onSelect: (e: SyntheticEvent<Box>) => void;
    onScroll: (e: UIEvent<Box>) => void;
    onKeyDown: (e: KeyboardEvent<Box>) => void;
  };
  ghostProps: {
    onPointerDown: (e: PointerEvent<HTMLSpanElement>) => void;
    onMouseDown: (e: MouseEvent<HTMLSpanElement>) => void;
    onClick: () => void;
  };
}

/** Whether the caret is at the end of the field's text with nothing selected: where faint text goes. */
function caretAtEnd(box: Box): boolean {
  const end = box.value.length;
  return box.selectionStart === end && box.selectionEnd === end;
}

/** Whether a key takes the faint text: Tab or the right arrow, on its own. */
function takes(e: KeyboardEvent<Box>): boolean {
  if (e.nativeEvent.isComposing) {
    return false;
  }
  if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) {
    return false;
  }
  return e.key === 'Tab' || e.key === 'ArrowRight';
}

/**
 * The suggestion as it goes after the field's text. The server joins it to the text trimmed, so
 * when a space or a new line is typed already, the one it starts with goes.
 */
function fitted(value: string, text: string): string {
  if (/\s$/.test(value)) {
    return text.trimStart();
  }
  return text;
}

/** Scrolls the mirror with the field, so the faint text stays right after the field's text. */
function follow(box: Box, mirror: HTMLDivElement) {
  mirror.scrollTop = box.scrollTop;
  mirror.scrollLeft = box.scrollLeft;
}

/** Narrows the mirror's text by the field's scrollbar, when it has one, so both wrap alike. */
function matchGutter(box: Box, mirror: HTMLDivElement) {
  const style = getComputedStyle(box);
  const borders = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
  const scrollbar = box.offsetWidth - box.clientWidth - borders;
  // A pixel or less is rounding, not a scrollbar.
  if (scrollbar <= 1) {
    return;
  }
  const padding = parseFloat(style.paddingRight);
  mirror.style.paddingRight = `${padding + scrollbar}px`;
}

/** Grows a paragraph field to fit the faint text too, as far as it may grow. */
function makeRoom(box: HTMLTextAreaElement, mirror: HTMLDivElement) {
  const borders = box.offsetHeight - box.clientHeight;
  let height = mirror.scrollHeight + borders;
  const most = parseFloat(getComputedStyle(box).maxHeight);
  if (height > most) {
    height = most;
  }
  box.style.minHeight = `${height}px`;
}

/**
 * Procreator's faint text for a field. It's asked for when the field is clicked into, once the
 * page has enough on it to go on, and shows while the caret is at the end of the field's text.
 * Typing in the field or leaving it clears it. `max` is what the field holds.
 */
export function useGhost(field: FieldRef | undefined, value: string, max: number, onChange: (value: string) => void): Ghosting {
  const help = useContext(HelpContext);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [atEnd, setAtEnd] = useState(false);
  const box = useRef<Box | null>(null);
  const mirror = useRef<HTMLDivElement | null>(null);
  // What last pressed the faint text: a tap takes it, a mouse click doesn't.
  const pointer = useRef('');

  // A callback, since the same ref goes on a line field or a paragraph field.
  const boxRef = useCallback((el: Box | null) => {
    box.current = el;
  }, []);

  useEffect(() => {
    if (!asking) {
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      suggestFor(asking.ask, ctrl.signal).then(
        (text) => {
          if (ctrl.signal.aborted) {
            return;
          }
          setAsking(null);
          const ghostText = fitted(asking.value, text);
          if (ghostText !== '') {
            setGhost({ text: ghostText, after: asking.value });
          }
        },
        () => {
          // When Procreator can't help (offline, or no answer), nothing shows: the field is just
          // a field.
          if (!ctrl.signal.aborted) {
            setAsking(null);
          }
        },
      );
    }, ASK_AFTER);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [asking]);

  let shown = '';
  if (ghost && ghost.after === value && atEnd) {
    shown = ghost.text;
  }

  useLayoutEffect(() => {
    const el = box.current;
    if (el instanceof HTMLTextAreaElement) {
      // A paragraph field fits its own text again, until there's faint text to fit as well.
      el.style.minHeight = '';
    }
    const copy = mirror.current;
    if (!el || !copy || shown === '') {
      return;
    }
    matchGutter(el, copy);
    if (el instanceof HTMLTextAreaElement) {
      makeRoom(el, copy);
    }
    follow(el, copy);
  }, [shown]);

  /** Forgets the faint text, and stops asking for it. */
  function stop() {
    setAsking(null);
    setGhost(null);
  }

  /** Puts the faint text in the field as if it were typed, so undo takes it back out. */
  function take(text: string) {
    const el = box.current;
    if (!el) {
      return;
    }
    el.focus();
    // The field's own change, which this sets off, clears the faint text.
    const typedIn = document.execCommand('insertText', false, text);
    if (typedIn) {
      return;
    }
    // A browser that can't type it in gets it as a plain change, which undo can't take back.
    stop();
    onChange((value + text).slice(0, max));
  }

  function onFocus(e: FocusEvent<Box>) {
    setAtEnd(caretAtEnd(e.currentTarget));
    if (!field || !help) {
      return;
    }
    // Back from another window: what was on its way or showing carries on.
    if (asking) {
      return;
    }
    if (ghost && ghost.after === value) {
      return;
    }
    setGhost(null);
    if (filledIn(help.setup) < SUGGEST_AFTER) {
      return;
    }
    const ask: FieldAsk = { setup: help.setup, field, bookId: help.bookId };
    setAsking({ ask, value });
  }

  function onBlur(e: FocusEvent<Box>) {
    // Still the focused field: only the window lost focus, and the field gets it back with it.
    if (document.activeElement === e.currentTarget) {
      return;
    }
    stop();
  }

  function onSelect(e: SyntheticEvent<Box>) {
    setAtEnd(caretAtEnd(e.currentTarget));
  }

  function onScroll(e: UIEvent<Box>) {
    if (mirror.current) {
      follow(e.currentTarget, mirror.current);
    }
  }

  function onKeyDown(e: KeyboardEvent<Box>) {
    if (shown === '') {
      return;
    }
    if (takes(e)) {
      e.preventDefault();
      take(shown);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      // Only the faint text goes: the sheet the field is on stays open.
      e.stopPropagation();
      stop();
    }
  }

  const ghostProps = {
    onPointerDown: (e: PointerEvent<HTMLSpanElement>) => {
      pointer.current = e.pointerType;
    },
    // Keeps the field focused with its caret where it was, on a phone too.
    onMouseDown: (e: MouseEvent<HTMLSpanElement>) => {
      e.preventDefault();
    },
    onClick: () => {
      // On a laptop, Tab and the arrow are right there, and a click near the end of the text
      // shouldn't take a paragraph by accident.
      if (pointer.current === 'mouse') {
        return;
      }
      take(shown);
    },
  };

  return {
    shown,
    typed: stop,
    boxRef,
    mirrorRef: mirror,
    boxProps: { onFocus, onBlur, onSelect, onScroll, onKeyDown },
    ghostProps,
  };
}
