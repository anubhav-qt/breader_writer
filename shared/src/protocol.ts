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
  /** Whether this account signs the AI accounts in and out (the server's OWNER_EMAILS). */
  owner: z.boolean().default(false),
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
 * What the owner's own AI (the house) writes for an account (step 9): everything, for the invited;
 * a first chapter still to come; or that chapter used, so going on needs the account's own AI.
 */
export const HouseStanding = z.enum(['always', 'first_chapter', 'used']);
export type HouseStanding = z.infer<typeof HouseStanding>;

/**
 * GET and PUT /v1/settings. `using` is what the story runs on now: the account's choice, or the
 * default until it makes one, moved to the nearest the model takes. `models` is null while the
 * proxy can't be reached, and then the AI is offline. `house` is what the owner's AI writes for
 * the account.
 */
export const Settings = z.object({
  using: ModelChoice,
  models: z.array(ModelInfo).nullable(),
  house: HouseStanding.default('always'),
});
export type Settings = z.infer<typeof Settings>;

/** The kinds of AI account the owner signs in from settings. */
export const Provider = z.enum(['antigravity', 'codex', 'claude']);
export type Provider = z.infer<typeof Provider>;

/** An AI account signed in to the proxy, as settings show it to the owner. */
export const AiAccount = z.object({
  /** The proxy's name for it, to sign it out by. */
  id: z.string(),
  /** Its kind: antigravity, codex, claude, or another the proxy knows. */
  provider: z.string(),
  /** Who it's signed in as: its email, or the proxy's label for it. */
  name: z.string(),
  /** Why it can't serve right now (turned off, out of quota), or null while it can. */
  problem: z.string().nullable(),
});
export type AiAccount = z.infer<typeof AiAccount>;

/** GET /v1/accounts, for the owner. */
export const AiAccounts = z.object({
  accounts: z.array(AiAccount),
});
export type AiAccounts = z.infer<typeof AiAccounts>;

/** POST /v1/accounts/sign-in: the kind of account to sign in. */
export const StartSignIn = z.object({
  provider: Provider,
});
export type StartSignIn = z.infer<typeof StartSignIn>;

/** What POST /v1/accounts/sign-in answers: the page to sign in on, and the sign-in to ask after. */
export const SignIn = z.object({
  url: z.string(),
  state: z.string(),
});
export type SignIn = z.infer<typeof SignIn>;

/** GET /v1/accounts/sign-in/:state: still waiting, signed in, or failed and why. */
export const SignInStatus = z.object({
  status: z.enum(['wait', 'ok', 'error']),
  error: z.string().nullable(),
});
export type SignInStatus = z.infer<typeof SignInStatus>;

/**
 * POST /v1/accounts/sign-in/:state: the address the sign-in page ended on, for when the browser
 * isn't on the proxy's machine and that page couldn't load.
 */
export const SignInAddress = z.object({
  address: z.string().trim().min(1).max(4000),
});
export type SignInAddress = z.infer<typeof SignInAddress>;
