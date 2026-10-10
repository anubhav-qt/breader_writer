import { z } from 'zod';
import { Id, LONG_LIMIT } from './book.ts';

/*
 * Play (step 6): the owner lives the story a move at a time, and Procreator narrates it. What the
 * play page shows, what it asks the server, and the events a move streams back (see CLAUDE.md,
 * "The play reads like a book page" and after).
 */

/**
 * As someone in the cast, as the author (a note the story follows and never says), a scene's
 * opening, or someone's actor playing them when the owner let it.
 */
export const Voice = z.enum(['character', 'author', 'opening', 'actor']);
export type Voice = z.infer<typeof Voice>;

/** How the owner can write a move: as their character, or as the author. */
export const MoveVoice = z.enum(['character', 'author']);
export type MoveVoice = z.infer<typeof MoveVoice>;

export const Person = z.object({ id: Id, name: z.string() });
export type Person = z.infer<typeof Person>;

/** A scene as its heading shows it: its number, over where and when it takes place. */
export const SceneHead = z.object({ number: z.number().int(), place: z.string(), time: z.string() });
export type SceneHead = z.infer<typeof SceneHead>;

/** One of the openings Procreator offers for the story's first scene. */
export const Opening = z.object({ text: z.string(), place: z.string(), time: z.string() });
export type Opening = z.infer<typeof Opening>;

/** Someone joining the cast, a relationship shifting, or a rewrite of the past: a quiet line in the page after the turn it happened at. */
export const Mark = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('joined'), id: Id, name: z.string() }),
  z.object({ kind: z.literal('shifted'), a: Id, b: Id, between: z.string(), text: z.string() }),
  /** The owner's change reached back here: what it was, and how many passages it rewrote, listed by the change. */
  z.object({ kind: z.literal('rewrote'), change: z.number().int(), what: z.string(), count: z.number().int() }),
]);
export type Mark = z.infer<typeof Mark>;

export const PlayTurn = z.object({
  id: z.uuid(),
  number: z.number().int(),
  voice: Voice,
  /** For a move, who the owner played; for an actor's turn, who the actor played. */
  played: Person.nullable(),
  /**
   * The owner's words: a move, a note, or their pick of how the story opens. Empty for a later
   * scene's opening. For an actor's turn, the actor's answer, which the page doesn't show.
   */
  input: z.string(),
  /** Procreator's narration. Empty when it never came. */
  reply: z.string(),
  marks: z.array(Mark),
});
export type PlayTurn = z.infer<typeof PlayTurn>;

/**
 * Where the play stands:
 * - start: nothing yet; the first scene's openings are to be asked for.
 * - openings: the openings are offered, for the owner to pick one or write their own.
 * - opening: a scene has begun and is waiting for Procreator to open it.
 * - playing: a scene is being played.
 * - cue: someone in the cast is about to act, and the owner says who plays them this time.
 * - ended: a scene has ended, and the next waits for the owner to go on.
 */
export const Stage = z.enum(['start', 'openings', 'opening', 'playing', 'cue', 'ended']);
export type Stage = z.infer<typeof Stage>;

/** The play as the page shows it: the scene on the page and its turns. */
export const Play = z.object({
  bookId: Id,
  title: z.string(),
  protagonist: Person,
  stage: Stage,
  /** The scene on the page: the one being played, or the one that just ended. */
  scene: SceneHead.nullable(),
  openings: z.array(Opening).nullable(),
  turns: z.array(PlayTurn),
  /** Who is about to act, while the owner says who plays them. */
  cue: Person.nullable(),
  /** Once a scene has ended, the one waiting for the owner to go on to it. */
  next: SceneHead.nullable(),
});
export type Play = z.infer<typeof Play>;

/**
 * Whether the owner plays others too (the switch "Main character and author only", off): then
 * Procreator asks before anyone in the cast acts, and the owner plays them or lets their actor.
 * Every ask that has Procreator write says it.
 */
const playOthers = z.boolean().default(false);

/** Going on with the story: on to the next scene, another reply, or letting an actor play. */
export const Going = z.object({ playOthers });
export type Going = z.infer<typeof Going>;

/**
 * The owner's move, or a note as the author. A move is the protagonist's, or, when Procreator
 * asked, the one about to act (`as`, by id).
 */
export const MoveAsk = z.object({
  voice: MoveVoice,
  text: z.string().trim().min(1).max(LONG_LIMIT),
  as: Id.optional(),
  playOthers,
});
export type MoveAsk = z.infer<typeof MoveAsk>;

/** How the owner opens the story: one of the openings offered, or one of their own. */
export const OpenAsk = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pick'), opening: z.number().int().min(0), playOthers }),
  z.object({ kind: z.literal('own'), text: z.string().trim().min(1).max(LONG_LIMIT), playOthers }),
]);
export type OpenAsk = z.infer<typeof OpenAsk>;

/** A turn taken back: the play as it stands, and the owner's words and voice for the box again (none for an actor's). */
export const Undone = z.object({ play: Play, voice: Voice, words: z.string() });
export type Undone = z.infer<typeof Undone>;

/** Three moves the owner could make next. */
export const Hints = z.object({ moves: z.array(z.string()) });
export type Hints = z.infer<typeof Hints>;

/**
 * What a move streams back: the scene's heading when it's set, a line while the scene before is
 * being finished, Procreator's words as it writes them, then the play as it stands, or why it
 * couldn't go on (with the play as it stands: a move that failed is taken back).
 */
export const PlayEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('scene'), scene: SceneHead }),
  z.object({ type: z.literal('finishing'), scene: z.number().int() }),
  z.object({ type: z.literal('text'), delta: z.string() }),
  z.object({ type: z.literal('done'), play: Play }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string(), play: Play }),
]);
export type PlayEvent = z.infer<typeof PlayEvent>;
