import type { FieldSize } from './view.ts';

/*
 * Turning the model's answer into the faint text a field shows after what's written in it: only
 * the words to add, joined to the text the way they'd be typed, and no more than the field holds.
 * Models wrap and label their answers now and then, and sometimes start by repeating the text, so
 * all of that comes off first.
 */

/** Punctuation that closes what comes before it, so it follows the text with no space. */
const CLOSERS = /^[,.;:!?)\]}…’”]/;

/** A label a model sometimes puts before its answer. */
const LABEL = /^(suggestion|answer|continuation)\s*:\s*/i;

/** A code fence around the whole answer. */
const FENCE = /^```[^\n]*\n([\s\S]*?)\n?```$/;

/** Quotes a model sometimes puts around its whole answer, as each opens and closes. */
const QUOTES: [string, string][] = [
  ['"', '"'],
  ['“', '”'],
];

/** The answer without quotes around the whole of it. Quotes inside it stay. */
function unquoted(text: string): string {
  for (const [open, close] of QUOTES) {
    if (text.length < 2 || !text.startsWith(open) || !text.endsWith(close)) {
      continue;
    }
    const inside = text.slice(1, -1);
    if (!inside.includes(close)) {
      return inside;
    }
  }
  return text;
}

/** The answer without a fence, a label or quotes around it, and without space at either end. */
function cleaned(answer: string): string {
  let text = answer.trim();
  const fenced = text.match(FENCE);
  if (fenced) {
    text = fenced[1].trim();
  }
  text = text.replace(LABEL, '');
  text = unquoted(text);
  return text.trim();
}

/** The answer joined to what's written: after a space, unless it starts on a new line or closes what came before. */
function joined(written: string, text: string, startsNewLine: boolean, size: FieldSize): string {
  if (written === '') {
    return text;
  }
  // A model that starts by repeating the text goes on from it as it wrote it.
  if (text.startsWith(written)) {
    return text.slice(written.length);
  }
  if (startsNewLine && size !== 'line') {
    return `\n${text}`;
  }
  if (CLOSERS.test(text)) {
    return text;
  }
  return ` ${text}`;
}

/** At most `room` characters, cut at the end of a word. */
function capped(ghost: string, room: number): string {
  if (room <= 0) {
    return '';
  }
  if (ghost.length <= room) {
    return ghost;
  }
  // One more than fits, to see whether the cut falls between two words.
  const kept = ghost.slice(0, room + 1);
  const lastBreak = kept.search(/\s+\S*$/);
  if (lastBreak <= 0) {
    return '';
  }
  return kept.slice(0, lastBreak);
}

/**
 * The faint text to show after `written` (the field's text, trimmed, as the page sent it), from
 * the model's answer. A line field gets one line. Empty when there's nothing to add.
 */
export function ghostFrom(written: string, answer: string, size: FieldSize, max: number): string {
  const startsNewLine = /^[ \t]*\n/.test(answer);
  let text = cleaned(answer);
  if (size === 'line') {
    text = text.replace(/\s+/g, ' ');
  }
  if (text === '') {
    return '';
  }
  const whole = joined(written, text, startsNewLine, size);
  const ghost = capped(whole, max - written.length);
  if (ghost.trim() === '') {
    return '';
  }
  return ghost;
}
