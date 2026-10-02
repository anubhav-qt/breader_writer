import { fileURLToPath } from 'node:url';
import nunjucks from 'nunjucks';

/*
 * The prompts are Nunjucks templates in templates/ (Jinja's syntax), as Seelie's studio has them.
 * Each takes a typed object that TypeScript prepares (story/view.ts); a template only lays it
 * out. A variable that's missing fails the render instead of leaving a hole in a prompt.
 */

const DIR = fileURLToPath(new URL('./templates/', import.meta.url));

let env: nunjucks.Environment | null = null;

function environment(): nunjucks.Environment {
  if (!env) {
    env = new nunjucks.Environment(new nunjucks.FileSystemLoader(DIR), {
      autoescape: false,
      throwOnUndefined: true,
      trimBlocks: true,
      lstripBlocks: true,
    });
  }
  return env;
}

/** At most one blank line in a row, and none at either end. */
function tidy(text: string): string {
  const collapsed = text.replace(/\n{3,}/g, '\n\n');
  return collapsed.trim();
}

/** Renders a template from templates/ with its data. */
export function render(name: string, data: object): string {
  const text = environment().render(name, data);
  return tidy(text);
}
