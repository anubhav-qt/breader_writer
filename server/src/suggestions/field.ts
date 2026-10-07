import type { DraftSetup, FieldRef } from '@writer/shared/suggestions';
import { render } from '../prompts/render.ts';
import { ghostFrom } from './ghost.ts';
import { askQuickly, type Helper } from './quick.ts';
import { fieldView, lengthFor, refsOf, setupView } from './view.ts';

/*
 * Procreator's suggestion for a field with text in it, once the owner clicks into it: what could
 * come next, made from the page as it stands.
 */

/**
 * The faint text for a field: what could come after its text, joined to it (ghostFrom), or empty
 * when Procreator has nothing to add or nobody is waiting any more. Null when the field isn't on
 * the page. A call that comes back with no answer is a ModelError.
 */
export async function suggestField(helper: Helper, setup: DraftSetup, field: FieldRef): Promise<string | null> {
  const refs = refsOf(setup);
  const view = fieldView(setup, field, refs);
  if (!view) {
    return null;
  }
  const system = render('suggestions/field-system.njk', {});
  const ask = render('suggestions/field.njk', { page: setupView(setup, refs), field: view, length: lengthFor(view) });
  const answer = await askQuickly(helper, system, ask);
  if (answer === null) {
    return '';
  }
  return ghostFrom(view.text, answer, view.size, view.max);
}
