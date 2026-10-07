import type { AgentTool, AgentToolResult } from '@writer/pi-agent';
import { Type } from '@writer/pi-ai';
import { editPage, forget, remember, shiftRelationship, writePage } from '../breading_ground.ts';
import type { Db } from '../db/client.ts';
import { log } from '../log.ts';
import { render } from '../prompts/render.ts';
import { castByName, namesOf } from '../story/cast.ts';
import { StoryError, type Writer } from '../story/changes.ts';
import { unlinked, type Cast } from '../story/mentions.ts';
import { findPage, PAGE_KINDS, type Outcome, type PageKind } from '../story/pages.ts';
import type { SideShift } from '../story/relationships.ts';
import type { Scene } from '../story/scenes.ts';
import { searchStory, type Recall } from '../story/search.ts';
import { characterView, pageView } from '../story/view.ts';

/*
 * Procreator's memory tools: the reference (read_page, write_page, edit_page), recall (search),
 * its memory (remember, forget) and the relationship graph (shift_relationship). Each does one
 * thing, and pi checks its arguments against its schema before it runs. A write is one change,
 * through breading_ground, tagged with the turn it's made at, so an undo takes it back with the
 * turn. Results are short and say what changed; a call the story turns down comes back saying how
 * to put it right.
 *
 * Their names, descriptions and schemas are part of every call's instructions, so they stay the
 * same from call to call, or the cache misses.
 */

/**
 * What a run is for, which says what its tools may do: play the story, fold it (a wrap-up or a
 * compaction), or offer the owner openings or moves to pick from, which saves nothing.
 */
export type Mode = 'play' | 'fold' | 'openings' | 'hints';

/** Where the tools work: the scene's session, at a turn, for one kind of run. */
export interface ToolContext {
  db: Db;
  scene: Scene;
  turnId: string | null;
  mode: Mode;
}

export type Result = AgentToolResult<Record<string, never>>;

const FAILED = "That failed on the writer's side, not because of the call. Carry on without it, and try again later if it still matters.";

/**
 * Runs a tool's work. The story's own refusals reach the model as they are, since they say how to
 * put the call right; anything else is the writer's fault, so it's logged and kept from the model.
 */
export async function guarded(tool: string, work: () => Promise<string>): Promise<Result> {
  try {
    const text = await work();
    return { content: [{ type: 'text', text }], details: {} };
  } catch (err) {
    if (err instanceof StoryError) {
      throw err;
    }
    log.error({ err, tool }, 'a tool failed');
    throw new Error(FAILED);
  }
}

export function writerOf(context: ToolContext): Writer {
  return { bookId: context.scene.bookId, turnId: context.turnId, by: 'agent' };
}

/** Nothing is saved while Procreator offers the owner openings or moves: the offer is all it makes. */
function mustSave(context: ToolContext) {
  if (context.mode === 'openings') {
    throw new StoryError('Nothing is saved while you offer openings. Call offer_openings instead.');
  }
  if (context.mode === 'hints') {
    throw new StoryError('Nothing is saved while you offer moves. Call offer_moves instead.');
  }
}

/** Says what a write did to a page. */
function pageOutcome(title: string, outcome: Outcome): string {
  if (outcome === 'made') {
    return `Made the page ${title}.`;
  }
  if (outcome === 'changed') {
    return `Changed the page ${title}.`;
  }
  return `The page ${title} says that already, so nothing changed.`;
}

const Title = Type.String({ description: "The page's title as your brief's index gives it, or the name of someone in the cast." });

const ReadPage = Type.Object({ title: Title });

function readPageTool(context: ToolContext): AgentTool<typeof ReadPage> {
  return {
    name: 'read_page',
    label: 'Read a page',
    description:
      "Reads a page of the reference, whole. Someone in the cast has a page under their name: the owner's sheet, then your page below it. Read a page before you rely on it or change it, unless your brief holds it already.",
    parameters: ReadPage,
    execute: (_id, params) =>
      guarded('read_page', async () => {
        const found = await findPage(context.db, context.scene.bookId, params.title);
        const names = namesOf(found.cast);
        if (found.character) {
          const person = characterView(found.character, found.page, names);
          return render('procreator/read.njk', { person, page: null });
        }
        if (found.page) {
          return render('procreator/read.njk', { person: null, page: pageView(found.page, names) });
        }
        throw new StoryError(
          `There's no page called ${params.title}. Your brief's index lists every page, and everyone in the cast has one under their name.`,
        );
      }),
  };
}

const WritePage = Type.Object({
  title: Type.String({
    description:
      'The title: the name of someone in the cast, a place, a group, a thing, a part of the world, or Plan, Threads or Timeline.',
  }),
  // A string with its values listed, which every provider's schema checks take.
  kind: Type.Unsafe<PageKind>({
    type: 'string',
    enum: [...PAGE_KINDS],
    description:
      'character for someone in the cast; place; group (a family, a guild, a crew); thing (an object that matters); lore (a part of the world: its history, rules, magic or customs); story for Plan, Threads and Timeline.',
  }),
  about: Type.String({ description: 'One line for the index: what the page holds. A character page can leave it empty.' }),
  body: Type.String({ description: 'The whole page, in Markdown, with everyone in the cast written as [[Name]]. It replaces what the page said.' }),
});

function writePageTool(context: ToolContext): AgentTool<typeof WritePage> {
  return {
    name: 'write_page',
    label: 'Write a page',
    description:
      "Writes a page of the reference whole: makes it, or replaces everything it said (the old version is kept). To change or add to part of a page, edit_page is safer. Someone in the cast has their page under their name, below the owner's sheet, which isn't yours to change.",
    parameters: WritePage,
    execute: (_id, params) =>
      guarded('write_page', async () => {
        mustSave(context);
        const write = { title: params.title, kind: params.kind, about: params.about, body: params.body };
        const written = await context.db.transaction((tx) => writePage(tx, writerOf(context), write));
        return pageOutcome(params.title.trim(), written.outcome);
      }),
  };
}

const EditPage = Type.Object({
  title: Title,
  find: Type.String({
    description: 'Text on the page to change, copied exactly as you last read it, and there once. Leave it empty to add to the end of the page.',
  }),
  replace: Type.String({ description: 'What it becomes, or what to add, with everyone in the cast written as [[Name]].' }),
});

function editPageTool(context: ToolContext): AgentTool<typeof EditPage> {
  return {
    name: 'edit_page',
    label: 'Edit a page',
    description:
      "Changes part of a page of the reference: the text in find becomes the text in replace. With find empty, it adds replace to the end of the page, which is how someone's growth is written. On someone in the cast it changes your page, never the owner's sheet.",
    parameters: EditPage,
    execute: (_id, params) =>
      guarded('edit_page', async () => {
        mustSave(context);
        const change = { title: params.title, find: params.find, replace: params.replace };
        const written = await context.db.transaction((tx) => editPage(tx, writerOf(context), change));
        return pageOutcome(params.title.trim(), written.outcome);
      }),
  };
}

const Search = Type.Object({
  words: Type.String({ description: "A few words as they'd be written: a name, a phrase, a line someone said." }),
  from: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: 'Leave it out to see the first places. When a search says there are more, the number it says to go on from.',
    }),
  ),
});

/** Says what a search found, and how to see the rest. */
function recallText(recall: Recall): string {
  if (recall.total === 0) {
    return 'Nothing has those words. Try fewer, or other words for the same thing.';
  }
  if (recall.matches.length === 0) {
    return `The places that have those words go up to ${recall.total}, so there are none from ${recall.from} on.`;
  }
  const lines = recall.matches.map((match) => `${match.where}: ${match.text}`);
  const last = recall.from + recall.matches.length - 1;
  if (last < recall.total) {
    lines.push(
      `Those are places ${recall.from} to ${last} of ${recall.total}. For the next ones, search again with from ${last + 1}, or narrow it down with more of the words.`,
    );
  } else if (recall.from > 1) {
    lines.push(`Those are places ${recall.from} to ${last} of ${recall.total}, the last of them.`);
  }
  return lines.join('\n');
}

function searchTool(context: ToolContext): AgentTool<typeof Search> {
  return {
    name: 'search',
    label: 'Search',
    description:
      "Finds exact words in the reference, the scene summaries and every turn played, and gives each place they come with the paragraph they're in, a dozen places at a time. Use it when a summary isn't enough: what exactly was said or promised, or when something first came up.",
    parameters: Search,
    execute: (_id, params) =>
      guarded('search', async () => {
        const recall = await searchStory(context.db, context.scene.bookId, params.words, params.from ?? 1);
        return recallText(recall);
      }),
  };
}

const Remember = Type.Object({
  note: Type.String({
    description: 'One line that stands on its own, with everyone in the cast written as [[Name]].',
  }),
});

function rememberTool(context: ToolContext): AgentTool<typeof Remember> {
  return {
    name: 'remember',
    label: 'Remember',
    description:
      "Keeps a note in your memory, which every brief holds whole: what the owner likes or doesn't, something they asked for that still holds, or a lesson about writing this book. What happens in the story goes in the reference instead.",
    parameters: Remember,
    execute: (_id, params) =>
      guarded('remember', async () => {
        mustSave(context);
        const kept = await context.db.transaction((tx) => remember(tx, writerOf(context), params.note));
        if (!kept.made) {
          return `That's note ${kept.note.id} already, so nothing changed.`;
        }
        return `Remembered as note ${kept.note.id}.`;
      }),
  };
}

const Forget = Type.Object({
  note: Type.Integer({ minimum: 1, description: "The note's number, as your brief or remember gave it." }),
});

function forgetTool(context: ToolContext): AgentTool<typeof Forget> {
  return {
    name: 'forget',
    label: 'Forget',
    description: 'Drops a note from your memory, once it no longer holds.',
    parameters: Forget,
    execute: (_id, params) =>
      guarded('forget', async () => {
        mustSave(context);
        await context.db.transaction((tx) => forget(tx, writerOf(context), params.note));
        return `Forgot note ${params.note}.`;
      }),
  };
}

const Side = Type.Object({
  who: Type.String({ description: 'One of the two, by name.' }),
  sees: Type.Optional(Type.String({ description: 'How they see the other now. It replaces what it said.' })),
  hides: Type.Optional(
    Type.String({ description: 'What they hide from the other now. It replaces what it said, and is empty once nothing is hidden.' }),
  ),
});

const Shift = Type.Object({
  between: Type.Array(Type.String(), { minItems: 2, maxItems: 2, description: 'The two people, by name.' }),
  bond: Type.Optional(
    Type.String({ description: 'What the two are to each other now ("sisters, rivals for the throne"). It replaces the old bond.' }),
  ),
  sides: Type.Optional(Type.Array(Side, { description: "Either one's side, if it changed." })),
  what: Type.String({
    description: 'What changed and why, for their history, with everyone in the cast written as [[Name]] ("[[Mara]] stops trusting [[Tobin]] after the trial").',
  }),
});

/** A name as Procreator wrote it, plainly or as a link, without the link's brackets. */
export function bareName(name: string): string {
  const opened = name.replace(/^\s*\[\[/, '');
  const closed = opened.replace(/\]\]\s*$/, '');
  return closed.trim();
}

/** The id of the one person in the cast with this name, written plainly or as a link. */
export function personNamed(cast: Cast, name: string): string {
  const bare = bareName(name);
  const ids = cast.idsOf(bare);
  if (ids.length === 0) {
    throw new StoryError(`No one in the cast is called ${bare}. A relationship is between two people in the cast.`);
  }
  if (ids.length > 1) {
    throw new StoryError(`More than one person in the cast is called ${bare}, so the relationship can't tell which.`);
  }
  return ids[0];
}

/** Says what a shift changed. */
function shiftOutcome(params: { between: string[]; bond?: string; sides?: { who: string }[] }): string {
  const parts: string[] = [];
  if (params.bond !== undefined) {
    parts.push(`their bond is now "${params.bond.trim()}"`);
  }
  for (const side of params.sides ?? []) {
    parts.push(`${side.who.trim()}'s side changed`);
  }
  const [one, other] = params.between;
  if (parts.length === 0) {
    return `Added to the history of ${one.trim()} and ${other.trim()}.`;
  }
  return `${one.trim()} and ${other.trim()}: ${parts.join(', ')}. Added to their history.`;
}

function shiftRelationshipTool(context: ToolContext): AgentTool<typeof Shift> {
  return {
    name: 'shift_relationship',
    label: 'Shift a relationship',
    description:
      "Changes how two people in the cast stand with each other, ties them first if they weren't, and adds what happened to their history. Leave out what stays the same. The relationships in your brief are as they stood when the scene began.",
    parameters: Shift,
    execute: (_id, params) =>
      guarded('shift_relationship', async () => {
        mustSave(context);
        const done = await context.db.transaction(async (tx) => {
          const cast = await castByName(tx, context.scene.bookId);
          const one = personNamed(cast, params.between[0]);
          const other = personNamed(cast, params.between[1]);
          const sides: SideShift[] = [];
          for (const side of params.sides ?? []) {
            sides.push({ id: personNamed(cast, side.who), sees: side.sees, hides: side.hides });
          }
          const what = unlinked(params.what, cast);
          return shiftRelationship(tx, writerOf(context), context.scene.id, { one, other, bond: params.bond, sides, what });
        });
        if (!done) {
          return 'That is in their history already, so nothing changed.';
        }
        return shiftOutcome(params);
      }),
  };
}

/** Every memory tool, for a run in the scene's session at this turn. */
export function memoryTools(context: ToolContext): AgentTool[] {
  return [
    readPageTool(context),
    writePageTool(context),
    editPageTool(context),
    searchTool(context),
    rememberTool(context),
    forgetTool(context),
    shiftRelationshipTool(context),
  ] as AgentTool[];
}
