import { and, asc, desc, eq, gt } from 'drizzle-orm';
import type { HouseStanding } from '@writer/shared/protocol';
import type { Db } from '../db/client.ts';
import { books, scenes } from '../db/schema.ts';
import type { Env } from '../env.ts';
import { isInvited } from '../lib/access.ts';
import { ApiError } from '../lib/errors.ts';
import type { Login } from '../lib/login.ts';

/*
 * The house: the owner's own AI, the accounts signed in to the proxy (CLIPROXY_*). It writes
 * everything for the invited (WRITER_EMAILS). Once the writer is open to all, it writes everyone
 * else's first chapter: setup help while their first book is being made and on it, and that book's
 * first scene, its wrap-up and its chapter. Past that, they bring their own AI (step 9).
 */

/** The house writes every scene of every book the invited write. */
export const EVERY_SCENE = Number.POSITIVE_INFINITY;
/** The free chapter is the first book's first scene. */
export const FIRST_SCENE = 1;

export const ownAiNeeded = () =>
  new ApiError(
    403,
    'own_ai_needed',
    'Your first chapter was on the house. To go on, bring your own AI: it’s in the model picker at the top.',
  );

/** The account's first book, by when it was made, or null before it makes one. */
async function firstBookId(db: Db, userId: string): Promise<string | null> {
  const [first] = await db
    .select({ id: books.id })
    .from(books)
    .where(eq(books.userId, userId))
    .orderBy(asc(books.createdAt), asc(books.id))
    .limit(1);
  if (!first) {
    return null;
  }
  return first.id;
}

/**
 * The last scene of a book the house writes for this account: every one for the invited, the
 * first of their first book for anyone else, and none of any other. A book not made yet (null) is
 * the first while the account has none.
 */
export async function houseReach(db: Db, env: Pick<Env, 'WRITER_EMAILS'>, login: Login, bookId: string | null): Promise<number> {
  if (isInvited(login, env)) {
    return EVERY_SCENE;
  }
  const first = await firstBookId(db, login.id);
  if (first === null) {
    return FIRST_SCENE;
  }
  if (bookId === first) {
    return FIRST_SCENE;
  }
  return 0;
}

/** Whether the first book has gone past its first scene, its next waiting included. */
async function pastFirstScene(db: Db, bookId: string): Promise<boolean> {
  const [later] = await db
    .select({ id: scenes.id })
    .from(scenes)
    .where(and(eq(scenes.bookId, bookId), gt(scenes.number, FIRST_SCENE)))
    .orderBy(desc(scenes.number))
    .limit(1);
  return Boolean(later);
}

/** What the model picker says about the house: it writes everything, the first chapter is still to come, or it's used. */
export async function houseStanding(db: Db, env: Pick<Env, 'WRITER_EMAILS'>, login: Login): Promise<HouseStanding> {
  if (isInvited(login, env)) {
    return 'always';
  }
  const first = await firstBookId(db, login.id);
  if (first === null) {
    return 'first_chapter';
  }
  if (await pastFirstScene(db, first)) {
    return 'used';
  }
  return 'first_chapter';
}
