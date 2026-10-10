import { describe, expect, it } from 'vitest';
import { notes, turns } from '../src/db/schema.ts';
import { mayName } from '../src/play/edits.ts';
import { applyEdits, type Applied } from '../src/procreator/rewrite.ts';
import { Cast } from '../src/story/mentions.ts';
import type { Passage } from '../src/story/passages.ts';

/*
 * Procreator's edits to the story's passages when a change reaches back (procreator/rewrite.ts),
 * and the passages a rename alone gives it (play/edits.ts).
 */

const cast = new Cast([
  { id: '00000000-0000-4000-8000-000000000001', name: 'Aiko' },
  { id: '00000000-0000-4000-8000-000000000002', name: 'Renji' },
]);

function narration(text: string): Passage {
  return { spot: { kind: 'story', table: turns, key: { id: 't' }, column: 'reply', linked: false }, where: 'Scene 1, turn 1: the narration', text };
}

function memory(text: string): Passage {
  return { spot: { kind: 'story', table: notes, key: { id: 1 }, column: 'text', linked: true }, where: 'Procreator’s memory', text };
}

function textsOf(applied: Applied): string[] {
  if (!applied.ok) {
    throw new Error(applied.problems.join('\n'));
  }
  return [...applied.texts.values()];
}

describe('applyEdits', () => {
  it('changes the words found once, each edit on the passage as the one before left it', () => {
    const applied = applyEdits(
      [narration('Ren rows. The boat is slow.')],
      [
        { passage: 1, find: 'Ren rows', text: 'Renji rows' },
        { passage: 1, find: 'Renji rows. The boat', text: 'Renji rows. The ferry' },
      ],
      cast,
    );
    expect(textsOf(applied)).toEqual(['Renji rows. The ferry is slow.']);
  });

  it('changes every place the words stand whole with every, and the whole passage without find', () => {
    const applied = applyEdits(
      [narration('Ren, Ren’s oar, and Renard.'), narration('Old words.')],
      [
        { passage: 1, find: 'Ren', every: true, text: 'Renji' },
        { passage: 2, text: 'New words.' },
      ],
      cast,
    );
    expect(textsOf(applied)).toEqual(['Renji, Renji’s oar, and Renard.', 'New words.']);
  });

  it('turns every problem away at once: words not there, words there twice, a passage that isn’t', () => {
    const applied = applyEdits(
      [narration('Ren rows. Ren rests.')],
      [
        { passage: 1, find: 'Ren sings', text: 'Renji sings' },
        { passage: 1, find: 'Ren', text: 'Renji' },
        { passage: 2, text: 'Anything.' },
      ],
      cast,
    );
    expect(applied.ok).toBe(false);
    if (!applied.ok) {
      expect(applied.problems).toEqual([
        'Passage 1 doesn’t have “Ren sings”. Check it against the passage as it stands, after your earlier edits to it.',
        '“Ren” is in passage 1 2 times. Give more of the words around the one to change, or set every.',
        'There’s no passage 2: they’re numbered 1 to 1.',
      ]);
    }
  });

  it('takes the dashes out of what it writes', () => {
    const applied = applyEdits([narration('Renji rows.')], [{ passage: 1, text: 'Renji rows\u2014slowly.' }], cast);
    const [text] = textsOf(applied);
    expect(text).not.toContain('\u2014');
  });

  it('lets a memory note be emptied, but never a turn', () => {
    const emptied = applyEdits([memory('Ren hates boats.')], [{ passage: 1, text: '' }], cast);
    expect(textsOf(emptied)).toEqual(['']);
    const turn = applyEdits([narration('Ren rows.')], [{ passage: 1, text: ' ' }], cast);
    expect(turn.ok).toBe(false);
  });

  it('checks links where the text keeps people as links, against the cast as it will stand', () => {
    const unknown = applyEdits([memory('[[Aiko]] trusts [[Ren]].')], [{ passage: 1, find: '[[Aiko]]', text: '[[Aiko]] still' }], cast);
    expect(unknown.ok).toBe(false);
    const fixed = applyEdits([memory('[[Aiko]] trusts [[Ren]].')], [{ passage: 1, find: '[[Ren]]', text: '[[Renji]]' }], cast);
    expect(textsOf(fixed)).toEqual(['[[Aiko]] trusts [[Renji]].']);
    // A narration has no links to keep.
    const told = applyEdits([narration('Ren rows.')], [{ passage: 1, text: '[[Ren]] rows.' }], cast);
    expect(told.ok).toBe(true);
  });

  it('leaves out a passage an edit left as it was', () => {
    const applied = applyEdits([narration('The boat is slow.')], [{ passage: 1, find: 'boat', text: 'boat' }], cast);
    expect(textsOf(applied)).toEqual([]);
  });
});

describe('mayName', () => {
  it('keeps the passages that may name someone, in any form and case, and drops a part with none', () => {
    const groups = [
      { scene: 1, passages: ['Ren rows.', 'REN!', 'Renny laughs.', 'The children sing.', 'Lorenzo waits.'].map(narration) },
      { scene: 2, passages: [narration('Aiko alone.')] },
    ];
    const kept = mayName(groups, 'Ren');
    expect(kept).toHaveLength(1);
    expect(kept[0].passages.map((passage) => passage.text)).toEqual(['Ren rows.', 'REN!', 'Renny laughs.']);
  });

  it('looks for each of a name’s words', () => {
    const kept = mayName([{ scene: null, passages: [narration('Mr Ito bows.')] }], 'Ren Ito');
    expect(kept).toHaveLength(1);
  });
});
