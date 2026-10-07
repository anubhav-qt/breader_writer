import { describe, expect, it } from 'vitest';
import { undashed, Undasher } from '../src/ai/dashes.ts';

/** The words streamed in these pieces, as the owner sees them. */
function streamed(pieces: string[]): string {
  const undasher = new Undasher();
  let out = '';
  for (const piece of pieces) {
    out += undasher.push(piece);
  }
  return out + undasher.flush();
}

describe('no dashes in what Procreator writes', () => {
  it('turns a dash between words into a comma', () => {
    expect(undashed('She turned—slowly—to face him.')).toBe('She turned, slowly, to face him.');
    expect(undashed('One thing was left — the key.')).toBe('One thing was left, the key.');
    expect(undashed('He said — "Stop."')).toBe('He said, "Stop."');
    expect(undashed('A cold–wet night')).toBe('A cold, wet night');
  });

  it('breaks speech off with an ellipsis, and drops a dash that opens a line or a quote', () => {
    expect(undashed('“I didn’t—” she said.')).toBe('“I didn’t…” she said.');
    expect(undashed('“—and then,” he said.')).toBe('“and then,” he said.');
    expect(undashed('— Hello.\n— Who’s there?')).toBe('Hello.\nWho’s there?');
    expect(undashed('Wait—')).toBe('Wait…');
    expect(undashed('Stop!—')).toBe('Stop!');
  });

  it('keeps punctuation that was there, ranges as hyphens, and hyphens as they are', () => {
    expect(undashed('Not now,— not ever.')).toBe('Not now, not ever.');
    expect(undashed('It was hers—.')).toBe('It was hers.');
    expect(undashed('pages 3–5')).toBe('pages 3-5');
    expect(undashed('Salt-stung and well-worn.')).toBe('Salt-stung and well-worn.');
  });

  it('does the same to words as they stream, holding a dash back until it can tell', () => {
    expect(streamed(['She turned—', 'slowly—to', ' face him.'])).toBe('She turned, slowly, to face him.');
    expect(streamed(['“I didn’t ', '—', '” she said.'])).toBe('“I didn’t…” she said.');
    expect(streamed(['One thing was left ', '— ', 'the key.'])).toBe('One thing was left, the key.');
    expect(streamed(['And then', '—'])).toBe('And then…');
  });

  it('passes words on as they come when nothing needs holding', () => {
    const undasher = new Undasher();
    expect(undasher.push('The river')).toBe('The river');
    expect(undasher.push(' rose ')).toBe(' rose');
    expect(undasher.push('fast.')).toBe(' fast.');
  });
});
