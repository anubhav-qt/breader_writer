import { normalizeContext, streamSimple, type UserMessage } from '@writer/pi-ai';
import { SCENE_WORDS, type Darkness, type Length, type Pov } from '@writer/shared/book';
import { counted, ModelError, recordCall, textOf, thinkingOf, type CallTag, type Sent } from '../ai/call.ts';
import { undashed } from '../ai/dashes.ts';
import type { Db } from '../db/client.ts';
import { render } from '../prompts/render.ts';
import { namesOf } from '../story/cast.ts';
import { chaptersOf, type Written } from '../story/chapters.ts';
import { readStory, type Story } from '../story/read.ts';
import { turnsOf, type Scene, type Turn, type Voice } from '../story/scenes.ts';
import { briefView, settingsView, type BriefView, type SettingsView, type TurnView } from '../story/view.ts';
import type { Procreator } from './run.ts';

/*
 * Procreator as the author (step 7): each scene, once it's played and wrapped up, written into the
 * book as a chapter of finished prose, in the book's point of view, style and darkness. One call
 * on the account's own model: the story as a brief, the chapter before for its voice, then the
 * scene's turns word for word, and the task last. The play is the draft; the chapter keeps what
 * happened and what was said, and gives it the room a book has.
 */

/** What the author's instructions take: the book, and who the owner played. The same for every chapter of a book. */
export interface AuthorView {
  protagonist: string;
  book: SettingsView & { title: string };
  lightNovel: boolean;
  /** About how many words a chapter runs to, written out. */
  sceneWords: string;
}

/** A chapter already in the book, as the next one reads it. */
export interface PreviousView {
  number: number;
  title: string;
  body: string;
}

/** What the author is asked: the story as a brief, the chapter before, and the scene to write. */
export interface ChapterAskView {
  brief: BriefView;
  previous: PreviousView | null;
  number: number;
  place: string;
  time: string;
  turns: TurnView[];
}

/** The author's instructions for a book. */
export function authorView(story: Story): AuthorView {
  const book = story.book;
  const settings = settingsView(book.length as Length, book.wordGoal, book.pov as Pov, book.darkness as Darkness);
  const protagonist = story.characters.find((person) => person.role === 'protagonist');
  return {
    protagonist: protagonist?.name ?? 'the protagonist',
    book: { title: book.title, ...settings },
    lightNovel: book.length === 'light_novel',
    sceneWords: SCENE_WORDS.toLocaleString('en-US'),
  };
}

/** A turn as the author reads it, with who the owner played by name. */
function turnView(turn: Turn, names: Map<string, string>, protagonist: string): TurnView {
  let played = protagonist;
  if (turn.played !== null) {
    played = names.get(turn.played) ?? protagonist;
  }
  return { number: turn.number, voice: turn.voice as Voice, played, input: turn.input, reply: turn.reply };
}

/** What the author is asked for a scene, from the story as it stands. */
export async function chapterAsk(db: Db, story: Story, scene: Scene): Promise<ChapterAskView> {
  const names = namesOf(story.characters);
  const protagonist = story.characters.find((person) => person.role === 'protagonist')?.name ?? '';
  const turns = await turnsOf(db, scene.id);
  const written = await chaptersOf(db, story.book.id);
  const before = written.filter((chapter) => chapter.number < scene.number).at(-1);
  let previous: PreviousView | null = null;
  if (before) {
    previous = { number: before.number, title: before.title, body: before.body };
  }
  return {
    brief: briefView(story, scene, []),
    previous,
    number: scene.number,
    place: scene.place,
    time: scene.time,
    turns: turns.map((turn) => turnView(turn, names, protagonist)),
  };
}

/** The text inside a tag, or null when the answer doesn't have it. */
function tagged(text: string, tag: string): string | null {
  const open = text.indexOf(`<${tag}>`);
  if (open === -1) {
    return null;
  }
  const start = open + tag.length + 2;
  const close = text.indexOf(`</${tag}>`, start);
  if (close === -1) {
    // Cut off before its end: what came is all there is.
    return text.slice(start).trim();
  }
  return text.slice(start, close).trim();
}

/** Prose as the book keeps it: paragraphs a blank line apart, whatever breaks the model put between them. */
function paragraphs(text: string): string {
  const kept: string[] = [];
  for (const line of text.split('\n')) {
    const paragraph = line.trim();
    if (paragraph) {
      kept.push(paragraph);
    }
  }
  return kept.join('\n\n');
}

/**
 * The chapter in an answer: its title in <title>, its prose in <chapter>. An answer without the
 * tags is taken as its first line for the title and the rest as the prose. Null when there's no
 * prose at all.
 */
export function chapterFrom(answer: string): Written | null {
  let title = tagged(answer, 'title');
  let body = tagged(answer, 'chapter');
  if (body === null) {
    const lines = answer.trim().split('\n');
    const first = lines[0] ?? '';
    if (title === null) {
      title = first.replace(/^#+\s*/, '').trim();
      body = lines.slice(1).join('\n');
    } else {
      body = answer.replace(/<title>[\s\S]*?<\/title>/, '');
    }
  }
  const prose = paragraphs(undashed(body));
  if (prose === '') {
    return null;
  }
  return { title: undashed(title ?? '').trim(), body: prose };
}

/**
 * Procreator writes a scene into the book. Throws a ModelError when the model doesn't answer, or
 * its chapter was cut off or empty; nothing is kept here.
 */
export async function writeUp(ai: Procreator, scene: Scene): Promise<Written> {
  const story = await readStory(ai.db, scene.bookId);
  const system = render('author/system.njk', authorView(story));
  const ask = render('author/ask.njk', await chapterAsk(ai.db, story, scene));
  const message: UserMessage = { role: 'user', content: ask, timestamp: Date.now() };
  const context = normalizeContext({ systemPrompt: system, messages: [message] });

  const sent: Sent = { startedAt: new Date(), estimate: counted(context.messages) };
  const stream = streamSimple(ai.inUse.model, context, {
    reasoning: thinkingOf(ai.inUse),
    apiKey: ai.inUse.apiKey,
    signal: ai.signal,
    // Every chapter of a book starts with the same instructions, so they can stay cached.
    sessionId: `author-${scene.bookId}`,
    cacheRetention: 'long',
  });
  const answer = await stream.result();
  const tag: CallTag = { userId: ai.userId, bookId: scene.bookId, sceneId: scene.id, turnId: null, role: 'author' };
  await recordCall(ai.db, tag, ai.inUse, sent, answer);

  if (answer.stopReason === 'error' || answer.stopReason === 'aborted') {
    throw new ModelError(answer.errorMessage ?? 'The model didn’t answer.');
  }
  if (answer.stopReason === 'length') {
    throw new ModelError(`Chapter ${scene.number} was cut off.`);
  }
  const chapter = chapterFrom(textOf(answer));
  if (!chapter) {
    throw new ModelError(`Procreator wrote nothing for chapter ${scene.number}.`);
  }
  return chapter;
}
