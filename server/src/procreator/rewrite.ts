import { runAgentLoop, type AgentContext, type AgentEvent, type AgentLoopConfig, type AgentMessage, type AgentTool, type AgentToolResult } from '@writer/pi-agent';
import { streamSimple, toToolDeclaration, Type, type AssistantMessage, type Message, type SystemMessage, type UserMessage } from '@writer/pi-ai';
import { counted, ModelError, recordCall, thinkingOf, type CallTag, type Sent } from '../ai/call.ts';
import { undashed } from '../ai/dashes.ts';
import { log } from '../log.ts';
import { render } from '../prompts/render.ts';
import type { ChangedView } from '../story/edits.ts';
import type { Cast } from '../story/mentions.ts';
import { linkProblem, mayEmpty, type Passage, type PassageGroup } from '../story/passages.ts';
import type { SettingsView } from '../story/view.ts';
import type { Procreator } from './run.ts';

/*
 * Procreator rewriting the past (see "Changing the past" in CLAUDE.md). When the owner's change
 * reaches back, a rename or a change that holds always so, Procreator is given the story's
 * passages a part at a time (a scene, then the reference, memory and the owner's sheets) and
 * edits whatever says otherwise, with exact words found in each passage. Edits that don't fit go
 * back to it to put right, as often as it takes. Nothing is kept here: the edits come back for
 * breading_ground to keep, all at once, once every part is done.
 */

/** What Procreator is told about the change, the same for every part. */
export interface RewriteBrief {
  book: SettingsView & { title: string };
  /** Everyone in the cast, by name, as it will stand. */
  cast: string[];
  /** What changed, field by field. */
  changed: ChangedView[];
  /** Names that change, each everywhere it's written. */
  renames: { was: string; now: string }[];
  /** People taken out of the story, as if they were never in it. */
  writtenOut: string[];
  /** A new point of view, which every narration is rewritten whole in. */
  pov: { was: string; now: string } | null;
  /** Whether the rest of the change holds always, beyond the renames. */
  always: boolean;
}

/** A passage as Procreator rewrote it. */
export interface Rewritten {
  passage: Passage;
  text: string;
}

/** One edit, as Procreator asks for it. */
export interface PassageEdit {
  passage: number;
  find?: string;
  every?: boolean;
  text: string;
}

export type Applied = { ok: true; texts: Map<number, string> } | { ok: false; problems: string[] };

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Where the words stand as whole words or a whole phrase: not inside a longer word. */
function wholly(words: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped(words)}(?![\\p{L}\\p{N}_])`, 'gu');
}

function timesIn(text: string, words: string): number {
  let count = 0;
  let from = text.indexOf(words);
  while (from !== -1) {
    count += 1;
    from = text.indexOf(words, from + words.length);
  }
  return count;
}

/** One edit made to a passage's text as it stands, or why it can't be. */
function editOne(text: string, edit: PassageEdit, replacement: string): { text: string } | { problem: string } {
  const find = edit.find ?? '';
  if (find === '') {
    return { text: replacement };
  }
  if (edit.every) {
    const pattern = wholly(find);
    if (!pattern.test(text)) {
      return { problem: `Passage ${edit.passage} doesn’t have “${find}” as whole words. Check it against the passage as it stands, after your earlier edits to it.` };
    }
    pattern.lastIndex = 0;
    return { text: text.replace(pattern, () => replacement) };
  }
  const times = timesIn(text, find);
  if (times === 0) {
    return { problem: `Passage ${edit.passage} doesn’t have “${find}”. Check it against the passage as it stands, after your earlier edits to it.` };
  }
  if (times > 1) {
    return { problem: `“${find}” is in passage ${edit.passage} ${times} times. Give more of the words around the one to change, or set every.` };
  }
  return { text: text.replace(find, () => replacement) };
}

/**
 * Makes Procreator's edits to the passages, in order, each on the passage as the edits before it
 * left it. Answers with each passage's new text where it changed, or every problem, so the call
 * can be put right whole.
 */
export function applyEdits(passages: Passage[], edits: PassageEdit[], cast: Cast): Applied {
  const texts = new Map<number, string>();
  const problems: string[] = [];
  for (const each of edits) {
    const passage = passages[each.passage - 1];
    if (!passage) {
      problems.push(`There’s no passage ${each.passage}: they’re numbered 1 to ${passages.length}.`);
      continue;
    }
    const current = texts.get(each.passage) ?? passage.text;
    const done = editOne(current, each, undashed(each.text));
    if ('problem' in done) {
      problems.push(done.problem);
      continue;
    }
    texts.set(each.passage, done.text);
  }
  for (const [number, text] of texts) {
    const passage = passages[number - 1];
    if (text.trim() === '' && !mayEmpty(passage)) {
      problems.push(`Passage ${number} (${passage.where}) can’t be left empty. Rewrite it instead.`);
      continue;
    }
    const problem = linkProblem(passage, text, cast);
    if (problem) {
      problems.push(`Passage ${number}: ${problem}`);
    }
  }
  if (problems.length > 0) {
    return { ok: false, problems };
  }
  for (const [number, text] of [...texts]) {
    if (text === passages[number - 1].text) {
      texts.delete(number);
    }
  }
  return { ok: true, texts };
}

const RewritePassages = Type.Object({
  edits: Type.Array(
    Type.Object({
      passage: Type.Integer({ description: 'The passage’s number.' }),
      find: Type.Optional(
        Type.String({
          description: 'The exact words to change, as the passage has them after your earlier edits to it, found in it once. Leave it out to rewrite the whole passage.',
        }),
      ),
      every: Type.Optional(Type.Boolean({ description: 'Change each place find stands as whole words, instead of the one place it is.' })),
      text: Type.String({ description: 'What goes in their place, or the whole passage’s new text when find is left out.' }),
    }),
    { description: 'Every edit these passages need, or none when nothing in them says otherwise.' },
  ),
});

type Result = AgentToolResult<Record<string, never>>;

function rewriteTool(group: PassageGroup, cast: Cast, outcome: { texts: Map<number, string> | null }): AgentTool<typeof RewritePassages> {
  return {
    name: 'rewrite_passages',
    label: 'Rewrite passages',
    description: 'Rewrites the passages you were given to fit the owner’s change, with every edit they need. Nothing is kept until every edit fits.',
    parameters: RewritePassages,
    execute: async (_id, params): Promise<Result> => {
      const applied = applyEdits(group.passages, params.edits, cast);
      if (!applied.ok) {
        const problems = applied.problems.join('\n');
        throw new Error(`${problems}\nNothing was kept. Put those right and call rewrite_passages again, with every edit.`);
      }
      outcome.texts = applied.texts;
      const text = `Kept edits to ${applied.texts.size} of the ${group.passages.length} passages.`;
      return { content: [{ type: 'text', text }], details: {}, terminate: true };
    },
  };
}

/** What a part of the story is called, for Procreator. */
function partOf(group: PassageGroup): string {
  if (group.scene === null) {
    return 'The reference, memory, the actors’ memories, and the owner’s sheets, lines and world';
  }
  return `Scene ${group.scene}`;
}

/** Procreator rewrites one part of the story. Answers with the passages it changed. */
async function rewriteGroup(ai: Procreator, bookId: string, brief: RewriteBrief, group: PassageGroup, cast: Cast): Promise<Rewritten[]> {
  const outcome: { texts: Map<number, string> | null } = { texts: null };
  const tools: AgentTool[] = [rewriteTool(group, cast, outcome)];
  const system: SystemMessage = {
    role: 'system',
    content: render('rewrite/system.njk', {}),
    toolsAdded: tools.map(toToolDeclaration),
    timestamp: 0,
  };
  const context: AgentContext = { messages: [system], tools };
  const ask = render('rewrite/ask.njk', { ...brief, part: partOf(group), passages: group.passages });
  const prompt: UserMessage = { role: 'user', content: ask, timestamp: Date.now() };

  let last: AssistantMessage | null = null;
  let sent: Sent | null = null;
  const tag: CallTag = { userId: ai.userId, bookId, sceneId: null, turnId: null, role: 'rewrite' };
  const keep = async (event: AgentEvent) => {
    if (event.type !== 'message_end' || (event.message as Message).role !== 'assistant') {
      return;
    }
    last = event.message as AssistantMessage;
    await recordCall(ai.db, tag, ai.inUse, sent ?? { startedAt: new Date(), estimate: 0 }, last);
  };
  // No cap on calls or time (quality first): edits that don't fit go back to Procreator as often
  // as it takes. A run that's stuck is stopped through the signal.
  const config: AgentLoopConfig = {
    model: ai.inUse.model,
    reasoning: thinkingOf(ai.inUse),
    apiKey: ai.catalog.proxy.apiKey,
    // Every part of a rewrite starts the same, so the cache can hold the instructions.
    sessionId: `rewrite-${bookId}`,
    cacheRetention: 'long',
    toolExecution: 'sequential',
    convertToLlm: (messages: AgentMessage[]) => messages as Message[],
    prepareRequest: (request) => {
      sent = { startedAt: new Date(), estimate: counted(request.context.messages) };
    },
  };
  await runAgentLoop([prompt], context, config, keep, ai.signal, streamSimple);

  const answer = last as AssistantMessage | null;
  if (!answer || answer.stopReason === 'error' || answer.stopReason === 'aborted') {
    throw new ModelError(answer?.errorMessage ?? 'Procreator didn’t answer.');
  }
  if (outcome.texts === null) {
    log.warn({ bookId, part: partOf(group) }, 'Procreator rewrote nothing, and never said so with rewrite_passages');
    return [];
  }
  const rewritten: Rewritten[] = [];
  for (const [number, text] of outcome.texts) {
    rewritten.push({ passage: group.passages[number - 1], text });
  }
  return rewritten;
}

/**
 * Procreator rewrites the story's passages to fit the owner's change, a part at a time, and tells
 * onProgress as each part is done. Answers with every passage it changed. Throws a ModelError when
 * the model doesn't answer, and nothing is kept.
 */
export async function rewritePast(
  ai: Procreator,
  bookId: string,
  brief: RewriteBrief,
  groups: PassageGroup[],
  cast: Cast,
  onProgress: (done: number, of: number) => void,
): Promise<Rewritten[]> {
  const rewritten: Rewritten[] = [];
  for (const [index, group] of groups.entries()) {
    rewritten.push(...(await rewriteGroup(ai, bookId, brief, group, cast)));
    onProgress(index + 1, groups.length);
  }
  return rewritten;
}
