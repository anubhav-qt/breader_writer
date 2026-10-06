import { StoryError } from './changes.ts';

/*
 * In the story's structured text (pages, memory, relationship history), a person in the cast is
 * written <@id>, never by name. The name lives once, on their sheet, and is filled in when the text
 * is shown, so renaming someone reaches every one of those places at once.
 *
 * Procreator reads and writes a person as a link, [[Name]]. Links become mentions when the text is
 * kept (unlinked), and mentions become links again when it's shown to Procreator (linked).
 */

const MENTION = /<@([0-9a-f-]{36})>/g;
const LINK = /\[\[([^[\]\n]+)\]\]/g;

/** How a person is written in the story's structured text. */
export function mention(id: string): string {
  return `<@${id}>`;
}

/** The ids of everyone a text mentions, each once. */
export function mentionsIn(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(MENTION)) {
    ids.add(match[1]);
  }
  return [...ids];
}

/** What a mention of someone no longer in the cast reads as. */
export const GONE = 'someone no longer in the cast';

/** The text with every mention replaced by the person's name. */
export function named(text: string, names: Map<string, string>): string {
  return text.replace(MENTION, (_whole, id: string) => {
    const name = names.get(id);
    if (name === undefined) {
      return GONE;
    }
    return name;
  });
}

/** The text as Procreator reads it: every mention a link with the person's name as it is now. */
export function linked(text: string, names: Map<string, string>): string {
  return text.replace(MENTION, (_whole, id: string) => {
    const name = names.get(id);
    if (name === undefined) {
      return GONE;
    }
    return `[[${name}]]`;
  });
}

/** A name as links match it: in any case, however it's spaced. */
function nameKey(name: string): string {
  const spaced = name.trim().replace(/\s+/g, ' ');
  return spaced.toLowerCase();
}

/** The cast by name, for turning links into mentions. */
export class Cast {
  private readonly ids = new Map<string, string[]>();

  constructor(people: { id: string; name: string }[]) {
    for (const person of people) {
      const key = nameKey(person.name);
      const same = this.ids.get(key) ?? [];
      same.push(person.id);
      this.ids.set(key, same);
    }
  }

  /** The ids of everyone called this: none, one, or more when two share a name. */
  idsOf(name: string): string[] {
    return this.ids.get(nameKey(name)) ?? [];
  }
}

/** The text as it's kept: every link to someone in the cast turned into a mention of them. */
export function unlinked(text: string, cast: Cast): string {
  const unknown = new Set<string>();
  const shared = new Set<string>();
  const kept = text.replace(LINK, (whole, name: string) => {
    const ids = cast.idsOf(name);
    if (ids.length === 1) {
      return mention(ids[0]);
    }
    if (ids.length === 0) {
      unknown.add(name.trim());
    } else {
      shared.add(name.trim());
    }
    return whole;
  });
  if (unknown.size > 0) {
    const names = [...unknown].join(', ');
    throw new StoryError(
      `No one in the cast is called ${names}. Links are only for people in the cast: write anyone or anything else without the brackets, or check the name against the cast.`,
    );
  }
  if (shared.size > 0) {
    const names = [...shared].join(', ');
    throw new StoryError(`More than one person in the cast is called ${names}, so a link can't tell them apart. Write them without the brackets.`);
  }
  return kept;
}
