/*
 * No em dashes or en dashes in anything Procreator writes: the owner's rule for all writing, the
 * story's included. Its instructions say so, and models still slip, so what it writes passes
 * through here on its way to the owner. A dash becomes what a careful writer would have used:
 * a comma between words, an ellipsis where speech breaks off, a hyphen in a range of numbers, and
 * nothing at the start of a line or a quote. Hyphens are left alone.
 */

/** A run of dashes (figure, en, em, the horizontal bar) with the spaces around it. */
const DASH_RUN = /[ \t]*[\u2012-\u2015]+[ \t]*/g;

/** What can follow a dash at the end of a stream's words so far: the next words may change it. */
const OPEN_END = /[ \t\u2012-\u2015]*$/;

/** What opens a quote or an aside, so a dash right after it starts what's said. */
const OPENERS = new Set(['"', '“', '‘', '(', '[']);

/** What closes a quote or an aside, so a dash right before it is speech breaking off. */
const CLOSERS = new Set(['"', '”', '’', "'", ')', ']']);

/** Punctuation that already ends or breaks the sentence where the dash is. */
const STOPS = new Set([',', ';', ':', '.', '!', '?', '…']);

const DIGIT = /[0-9]/;

/** What a dash run becomes, from the characters on either side of it ('' at the very start or end). */
function replacement(run: string, before: string, after: string): string {
  const spacedBefore = /^[ \t]/.test(run);
  const spacedAfter = /[ \t]$/.test(run);
  const startsLine = before === '' || before === '\n';
  const endsLine = after === '' || after === '\n';

  if (startsLine || (OPENERS.has(before) && !spacedBefore)) {
    return '';
  }
  if (endsLine || (CLOSERS.has(after) && !spacedAfter)) {
    if (STOPS.has(before)) {
      return '';
    }
    return '…';
  }
  if (DIGIT.test(before) && DIGIT.test(after) && !spacedBefore && !spacedAfter) {
    return '-';
  }
  if (STOPS.has(before)) {
    return ' ';
  }
  if (STOPS.has(after)) {
    return '';
  }
  return ', ';
}

/**
 * The text with every dash turned into what fits in its place. `before` is the character that came
 * just before the text, when it goes on from something already passed on.
 */
export function undashed(text: string, before = ''): string {
  return text.replace(DASH_RUN, (run: string, offset: number) => {
    let left = before;
    if (offset > 0) {
      left = text[offset - 1];
    }
    let right = '';
    const end = offset + run.length;
    if (end < text.length) {
      right = text[end];
    }
    return replacement(run, left, right);
  });
}

/**
 * Words as they stream in, without dashes. A dash, or space, at the end of what's come so far is
 * held back until the next words show what it should become; flush passes on what's left once
 * the words are done.
 */
export class Undasher {
  private held = '';
  /** The last character passed on. */
  private last = '';

  push(delta: string): string {
    const text = this.held + delta;
    const open = text.match(OPEN_END);
    let cut = text.length;
    if (open) {
      cut = text.length - open[0].length;
    }
    this.held = text.slice(cut);
    return this.pass(text.slice(0, cut));
  }

  flush(): string {
    const rest = this.held;
    this.held = '';
    return this.pass(rest);
  }

  private pass(text: string): string {
    const clean = undashed(text, this.last);
    if (clean !== '') {
      this.last = clean[clean.length - 1];
    }
    return clean;
  }
}
