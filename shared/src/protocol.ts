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
