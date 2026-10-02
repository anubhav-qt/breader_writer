/*
 * In the story's structured text (facts, threads, the timeline, growth, relationship history,
 * the arc), a person is written <@id>, never by name. The name lives once, on their sheet, and is
 * filled in when the context is built, so renaming someone reaches every one of those places at
 * once.
 */

const MENTION = /<@([0-9a-f-]{36})>/g;

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
