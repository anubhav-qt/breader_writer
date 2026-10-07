import { blankFields, type BlankSuggestion, type DraftSetup, type FieldRef } from '@writer/shared/suggestions';
import { render } from '../prompts/render.ts';
import { ghostFrom } from './ghost.ts';
import { askQuickly, type Helper } from './quick.ts';
import { fieldView, lengthFor, refsOf, setupView, type FieldView } from './view.ts';

/*
 * Procreator's suggestions for every field on the setup page still blank, made in one call so
 * they fit each other (the owner's ask, 2026-10-07). Each blank is numbered in the ask, and the
 * answer fills each by its number: <fill n="3">...</fill>.
 */

/** A blank field as the ask lists it: its number, where it is, what it holds and how much to write. */
interface BlankView {
  n: number;
  where: string;
  holds: string;
  length: string;
}

/** A blank field, its view, and its number in the ask. */
interface Blank {
  n: number;
  field: FieldRef;
  view: FieldView;
}

const FILL = /<fill\s+n\s*=\s*["']?(\d+)["']?\s*>([\s\S]*?)<\/fill>/g;

/** Each fill in the answer, by its number. A number filled twice keeps its first. */
export function fillsFrom(answer: string): Map<number, string> {
  const fills = new Map<number, string>();
  for (const match of answer.matchAll(FILL)) {
    const n = Number(match[1]);
    if (!fills.has(n)) {
      fills.set(n, match[2]);
    }
  }
  return fills;
}

/** The page's blank fields, numbered from 1 in the page's order. */
function blanksOf(setup: DraftSetup): Blank[] {
  const refs = refsOf(setup);
  const blanks: Blank[] = [];
  for (const field of blankFields(setup)) {
    const view = fieldView(setup, field, refs);
    if (view) {
      blanks.push({ n: blanks.length + 1, field, view });
    }
  }
  return blanks;
}

function blankView(blank: Blank): BlankView {
  return { n: blank.n, where: blank.view.where, holds: blank.view.holds, length: lengthFor(blank.view) };
}

/**
 * A suggestion for each blank field Procreator fills, in the page's order. Empty when nothing on
 * the page is blank, or nobody is waiting any more. A call that comes back with no answer is a
 * ModelError.
 */
export async function suggestBlanks(helper: Helper, setup: DraftSetup): Promise<BlankSuggestion[]> {
  const blanks = blanksOf(setup);
  if (blanks.length === 0) {
    return [];
  }
  const refs = refsOf(setup);
  const system = render('suggestions/blanks-system.njk', {});
  const ask = render('suggestions/blanks.njk', { page: setupView(setup, refs), blanks: blanks.map(blankView) });
  const answer = await askQuickly(helper, system, ask);
  if (answer === null) {
    return [];
  }

  const fills = fillsFrom(answer);
  const suggestions: BlankSuggestion[] = [];
  for (const blank of blanks) {
    const fill = fills.get(blank.n);
    if (fill === undefined) {
      continue;
    }
    const text = ghostFrom('', fill, blank.view.size, blank.view.max);
    if (text !== '') {
      suggestions.push({ field: blank.field, text });
    }
  }
  return suggestions;
}
