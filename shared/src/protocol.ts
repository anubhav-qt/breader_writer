import { z } from 'zod';
import { Length } from './book.ts';

/*
 * What the writer's server and app say to each other. Both import these shapes, so changing one
 * shows up as a type error on both sides.
 */

/** A breader account, as the writer shows it. */
export const Account = z.object({
  email: z.string(),
  name: z.string(),
  emailVerified: z.boolean(),
});
export type Account = z.infer<typeof Account>;

/**
 * Whether this browser may write, and if not, why not:
 *   logged_out    no breader login
 *   unconfirmed   logged in, but the email isn't confirmed yet
 *   invite_only   logged in and confirmed, but not on the list (the server's WRITER_EMAILS)
 *   open          on the list: can make and play books
 */
export const Access = z.enum(['logged_out', 'unconfirmed', 'invite_only', 'open']);
export type Access = z.infer<typeof Access>;

/** GET /v1/me */
export const Me = z.object({
  account: Account.nullable(),
  access: Access,
});
export type Me = z.infer<typeof Me>;

/** A book as its card in the library shows it. Times are milliseconds since 1970. POST /v1/books answers with it too. */
export const BookCard = z.object({
  id: z.string(),
  title: z.string(),
  /** A palette key from the app's book colours (frontend/src/data/colors.ts). */
  color: z.string(),
  length: Length,
  wordsWritten: z.number().int(),
  wordGoal: z.number().int(),
  createdAt: z.number(),
  /** When it was last played or changed. The library shows the most recent first. */
  updatedAt: z.number(),
});
export type BookCard = z.infer<typeof BookCard>;

/** GET /v1/books */
export const BookList = z.object({
  books: z.array(BookCard),
});
export type BookList = z.infer<typeof BookList>;

/** How hard a model thinks before it answers, weakest first. A model takes some of them. */
export const ThinkingLevel = z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
export type ThinkingLevel = z.infer<typeof ThinkingLevel>;

/** A model the accounts signed in to the proxy can serve, as settings show it. */
export const ModelInfo = z.object({
  id: z.string(),
  name: z.string(),
  /** The account kind serving it: antigravity, codex, claude. */
  provider: z.string(),
  /** In tokens. */
  contextWindow: z.number().int(),
  /** The levels it takes, weakest first. Just "off" for a model that doesn't think. */
  thinkingLevels: z.array(ThinkingLevel),
});
export type ModelInfo = z.infer<typeof ModelInfo>;

/** The model the story runs on, and how hard it thinks. PUT /v1/settings. */
export const ModelChoice = z.object({
  model: z.string().min(1).max(200),
  thinking: ThinkingLevel,
});
export type ModelChoice = z.infer<typeof ModelChoice>;

/**
 * GET and PUT /v1/settings. `using` is what the story runs on now: the account's choice, or the
 * default until it makes one, moved to the nearest the model takes. `models` is null while the
 * proxy can't be reached, and then the AI is offline.
 */
export const Settings = z.object({
  using: ModelChoice,
  models: z.array(ModelInfo).nullable(),
});
export type Settings = z.infer<typeof Settings>;
