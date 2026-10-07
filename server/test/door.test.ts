import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * breading_ground is the one door for changes to the story (the owner's design): outside it and
 * the story's own modules, nothing calls the story's writes. This reads every source file's
 * imports and holds the code to it.
 */

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/** The story's writes, by the module that has them. */
const WRITES: Record<string, string[]> = {
  'story/changes.ts': ['startChange', 'make', 'edit', 'remove', 'takeBack'],
  'story/pages.ts': ['writePage', 'editPage'],
  'story/memory.ts': ['remember', 'forget'],
  'story/relationships.ts': ['shiftRelationship', 'shiftOnce'],
  'story/cast.ts': ['joinCast'],
  'story/scenes.ts': [
    'startScene',
    'prepareScene',
    'beginScene',
    'reframeScene',
    'endScene',
    'summarize',
    'addTurn',
    'setReply',
    'markUndone',
  ],
  'story/session.ts': ['cutSession'],
};

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (name.endsWith('.ts')) {
      files.push(path);
    }
  }
  return files;
}

/** What a file imports, by the module path relative to src/. */
function importsOf(file: string): { module: string; names: string[] }[] {
  const text = readFileSync(file, 'utf8');
  const found: { module: string; names: string[] }[] = [];
  for (const match of text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'(\.[^']+)'/g)) {
    const module = relative(SRC, join(file, '..', match[2]));
    const names = match[1]
      .split(',')
      .map((part) => part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0])
      .filter((name) => name !== '');
    found.push({ module, names });
  }
  return found;
}

describe('breading_ground', () => {
  it('is the one door: nothing else calls the story’s writes', () => {
    const outside: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const path = relative(SRC, file);
      if (path === 'breading_ground.ts' || path.startsWith('story/')) {
        continue;
      }
      for (const { module, names } of importsOf(file)) {
        const writes = WRITES[module] ?? [];
        for (const name of names) {
          if (writes.includes(name)) {
            outside.push(`${path} imports ${name} from ${module}`);
          }
        }
      }
    }
    expect(outside).toEqual([]);
  });
});
