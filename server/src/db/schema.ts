import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/*
 * The writer's tables. They live in breader's database, in their own Postgres schema, `writer`,
 * with their own migrations table (writer.migrations, see migrate.ts), so the writer's migrations
 * and breader's never touch each other. drizzle-kit only looks at this file and this schema.
 */

export const writer = pgSchema('writer');

const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** A book: one story played and written, and what it was set up with. */
export const books = writer.table(
  'books',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The breader account that owns it: its Better Auth user id (breader's users.id). */
    userId: text('user_id').notNull(),
    title: text('title').notNull(),
    /** A palette key from the app's book colours. */
    color: text('color').notNull(),
    /** Short story, novella, light novel or novel (shared/src/book.ts). */
    length: text('length').notNull(),
    /** The length goal in words, from the length. The card's bar is words written over this. */
    wordGoal: integer('word_goal').notNull(),
    /** Point of view: third_close, first or third_omniscient. */
    pov: text('pov').notNull(),
    /** How dark it goes: gentle, mature or unflinching. */
    darkness: text('darkness').notNull(),
    wordsWritten: integer('words_written').notNull().default(0),
    createdAt: at('created_at').notNull().defaultNow(),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [index('books_user_idx').on(t.userId, t.updatedAt)],
);

/** A book's world: a few fields plus notes, blank where the owner left them blank. */
export const worlds = writer.table('worlds', {
  bookId: uuid('book_id')
    .primaryKey()
    .references(() => books.id, { onDelete: 'cascade' }),
  genre: text('genre').notNull().default(''),
  tone: text('tone').notNull().default(''),
  setting: text('setting').notNull().default(''),
  rules: text('rules').notNull().default(''),
  notes: text('notes').notNull().default(''),
});

/**
 * A character's sheet. The app makes the id, so it's only unique within its book: the key is the
 * book and the id together, and no book can reach another's characters.
 */
export const characters = writer.table(
  'characters',
  {
    bookId: uuid('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    id: uuid('id').notNull(),
    /** protagonist (the one the owner plays) or cast. */
    role: text('role').notNull(),
    /** Where they come in the cast, from 0. */
    position: integer('position').notNull(),
    name: text('name').notNull(),
    who: text('who').notNull().default(''),
    personality: text('personality').notNull().default(''),
    past: text('past').notNull().default(''),
    notes: text('notes').notNull().default(''),
  },
  (t) => [
    primaryKey({ columns: [t.bookId, t.id] }),
    uniqueIndex('characters_one_protagonist').on(t.bookId).where(sql`role = 'protagonist'`),
  ],
);

/**
 * A line in the relationship graph: the bond the two share, and each one's side (how they see the
 * other, what they hide from them). The pair is stored smaller id first, so it has one row.
 */
export const relationships = writer.table(
  'relationships',
  {
    bookId: uuid('book_id').notNull(),
    aId: uuid('a_id').notNull(),
    bId: uuid('b_id').notNull(),
    bond: text('bond').notNull().default(''),
    aSees: text('a_sees').notNull().default(''),
    aHides: text('a_hides').notNull().default(''),
    bSees: text('b_sees').notNull().default(''),
    bHides: text('b_hides').notNull().default(''),
  },
  (t) => [
    primaryKey({ columns: [t.bookId, t.aId, t.bId] }),
    check('relationships_in_order', sql`${t.aId} < ${t.bId}`),
    foreignKey({ columns: [t.bookId, t.aId], foreignColumns: [characters.bookId, characters.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.bookId, t.bId], foreignColumns: [characters.bookId, characters.id] }).onDelete('cascade'),
  ],
);

/** An account's own settings: the model its stories run on, and how hard it thinks. */
export const settings = writer.table('settings', {
  /** The breader account (its Better Auth user id). */
  userId: text('user_id').primaryKey(),
  /** A model id as the proxy lists it. */
  model: text('model').notNull(),
  /** off, minimal, low, medium, high, xhigh or max. */
  thinking: text('thinking').notNull(),
  updatedAt: at('updated_at').notNull().defaultNow(),
});

/*
 * The story: everything it knows lives in these tables, and each scene's session opens with a
 * brief built from them (story/session.ts, procreator/). Nothing here is ever deleted to save room.
 *
 * Every change to the story goes through the change log (story/changes.ts): one row in changes,
 * tagged with who made it and the turn it came from, and a row in versions for each row it
 * touched, before and after. That's what lets undo roll the story back, and a change be looked
 * over and taken back. So these tables keep no times of their own (the change has it), and in
 * the text they hold, people are written <@id> and named when it's shown, so a rename reaches
 * every one of them at once.
 */

/** A row number short enough for the model to name ("forget note 12"). */
const serial = () => bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity();
const bookRef = () =>
  uuid('book_id')
    .notNull()
    .references(() => books.id, { onDelete: 'cascade' });

/**
 * A scene: played turn by turn in a session of its own, wrapped up into its summary, then
 * written into the book.
 */
export const scenes = writer.table(
  'scenes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookId: bookRef(),
    /** 1, 2, 3 and on, in the book. */
    number: integer('number').notNull(),
    /** Where it happens. */
    place: text('place').notNull().default(''),
    /** When, in the story's own time ("the third night of the siege"). */
    time: text('time').notNull().default(''),
    /** Who is in it, by character id. */
    present: uuid('present').array().notNull().default(sql`'{}'::uuid[]`),
    /** playing, then ended. */
    status: text('status').notNull().default('playing'),
    /** What happened, written by its wrap-up once it has ended. Every later brief holds it. */
    summary: text('summary').notNull().default(''),
  },
  (t) => [
    uniqueIndex('scenes_book_number').on(t.bookId, t.number),
    uniqueIndex('scenes_one_playing').on(t.bookId).where(sql`status = 'playing'`),
  ],
);

/** A turn: the owner's move and the narrator's reply, word for word. */
export const turns = writer.table(
  'turns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookId: bookRef(),
    sceneId: uuid('scene_id')
      .notNull()
      .references(() => scenes.id),
    /** 1, 2, 3 and on, in the book. An undone turn keeps its number. */
    number: integer('number').notNull(),
    /** character (as the protagonist) or author (a note the story follows and never says). */
    voice: text('voice').notNull(),
    /** The owner's words. */
    input: text('input').notNull(),
    /** The narrator's words. */
    reply: text('reply').notNull().default(''),
    /** Taken back. Kept, and left out of the story. */
    undone: boolean('undone').notNull().default(false),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('turns_book_number').on(t.bookId, t.number), index('turns_scene_idx').on(t.sceneId, t.number)],
);

/** One change to the story, by the owner or the agent, at a turn. */
export const changes = writer.table(
  'changes',
  {
    id: serial(),
    bookId: bookRef(),
    /** The turn being played, or the latest when the owner changes something between turns. Null before the first. */
    turnId: uuid('turn_id').references(() => turns.id),
    /** owner or agent. */
    by: text('by').notNull(),
    /** What it did, in a few words ("Wrote the page The Keep"). */
    what: text('what').notNull(),
    /** Why, when there's a reason to give (a relationship shifting says why). */
    why: text('why').notNull().default(''),
    /** The change that took this one back, if one did. */
    takenBackBy: bigint('taken_back_by', { mode: 'number' }),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [index('changes_book_idx').on(t.bookId, t.id), index('changes_turn_idx').on(t.turnId)],
);

/** A row a change touched: what it was before, and after. */
export const versions = writer.table(
  'versions',
  {
    id: serial(),
    changeId: bigint('change_id', { mode: 'number' })
      .notNull()
      .references(() => changes.id, { onDelete: 'cascade' }),
    /** The table, as Postgres names it. */
    table: text('table_name').notNull(),
    /** The row's primary key, by column. */
    key: jsonb('key').notNull(),
    /** Before: null when the change made the row. For an edit, only the columns it changed. */
    before: jsonb('before'),
    /** After: null when the change removed the row. */
    after: jsonb('after'),
  },
  (t) => [index('versions_change_idx').on(t.changeId), index('versions_row_idx').on(t.table, t.key)],
);

/** How two people got where they are: each change to their relationship, in the scene it happened. */
export const relationshipHistory = writer.table(
  'relationship_history',
  {
    id: serial(),
    bookId: bookRef(),
    aId: uuid('a_id').notNull(),
    bId: uuid('b_id').notNull(),
    sceneId: uuid('scene_id').references(() => scenes.id),
    text: text('text').notNull(),
  },
  (t) => [
    index('relationship_history_pair_idx').on(t.bookId, t.aId, t.bId),
    check('relationship_history_in_order', sql`${t.aId} < ${t.bId}`),
  ],
);

/**
 * A page of the reference: the story's canon in depth, one subject a page, written by Procreator
 * as the story establishes things (story/pages.ts). A character's page is about a cast member,
 * and goes by their name: their sheet is the owner's (characters), and this is Procreator's depth
 * below it.
 */
export const pages = writer.table(
  'pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookId: bookRef(),
    /** character, place, group, thing, lore or story. */
    kind: text('kind').notNull(),
    /** On a character's page, the cast member it's about. */
    characterId: uuid('character_id'),
    /** What the index and the tools call it. Empty on a character's page, which has their name. */
    title: text('title').notNull().default(''),
    /** One line for the index: what the page holds. */
    about: text('about').notNull().default(''),
    /** The page, in Markdown. */
    body: text('body').notNull().default(''),
  },
  (t) => [
    index('pages_book_idx').on(t.bookId),
    uniqueIndex('pages_book_title').on(t.bookId, t.title).where(sql`character_id is null`),
    uniqueIndex('pages_book_character').on(t.bookId, t.characterId).where(sql`character_id is not null`),
    foreignKey({ columns: [t.bookId, t.characterId], foreignColumns: [characters.bookId, characters.id] }).onDelete('cascade'),
  ],
);

/**
 * Procreator's memory: its notes to itself about the work, not the story (the owner's taste,
 * what they've asked for that still holds, its own lessons). Every brief holds all of them.
 */
export const notes = writer.table(
  'notes',
  {
    id: serial(),
    bookId: bookRef(),
    text: text('text').notNull(),
  },
  (t) => [index('notes_book_idx').on(t.bookId)],
);

/*
 * A scene's session: the chat Procreator plays it in (story/session.ts). Like turns, it's raw
 * history, not part of the change log: it's only ever added to, and an undo marks what it cut as
 * undone instead of deleting it.
 */

/**
 * A stretch of a scene's session: the message it opens with (the brief, and after a compaction
 * the scene so far as well), then the session's messages from fromSeq on. The model is sent the
 * latest one that still stands.
 */
export const sessionSegments = writer.table(
  'session_segments',
  {
    id: serial(),
    bookId: bookRef(),
    sceneId: uuid('scene_id')
      .notNull()
      .references(() => scenes.id, { onDelete: 'cascade' }),
    /** 1 when the session opens, and one more for each compaction. */
    number: integer('number').notNull(),
    /** The message it opens with, word for word, so every call in it starts the same. */
    head: text('head').notNull(),
    /** The scene so far, from the turns before fromSeq. Empty in the first. */
    summary: text('summary').notNull().default(''),
    /** The first of the session's messages sent after the head. */
    fromSeq: integer('from_seq').notNull(),
    /** The turn it was made at. Null when the session opened before any. */
    turnId: uuid('turn_id').references(() => turns.id),
    /** Cut away by an undo. */
    undone: boolean('undone').notNull().default(false),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('session_segments_scene_number').on(t.sceneId, t.number)],
);

/** A message of a scene's session, as the model was sent it or sent it back. */
export const sessionMessages = writer.table(
  'session_messages',
  {
    id: serial(),
    bookId: bookRef(),
    sceneId: uuid('scene_id')
      .notNull()
      .references(() => scenes.id, { onDelete: 'cascade' }),
    /** 1, 2, 3 and on, through the session. */
    seq: integer('seq').notNull(),
    /** The turn it belongs to. */
    turnId: uuid('turn_id').references(() => turns.id),
    /**
     * play (the story), note (the owner telling Procreator of a change mid scene) or fold (a
     * compaction or wrap-up at work, never sent again).
     */
    kind: text('kind').notNull(),
    /** pi's message: a user's, Procreator's (assistant) or a tool's result. */
    message: jsonb('message').notNull(),
    /** Cut away by an undo. */
    undone: boolean('undone').notNull().default(false),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('session_messages_scene_seq').on(t.sceneId, t.seq)],
);

/** A call to a model, with what it was sent and what it used, so the budget can be seen. */
export const calls = writer.table(
  'calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The breader account whose model it ran on. */
    userId: text('user_id').notNull(),
    bookId: uuid('book_id').references(() => books.id, { onDelete: 'cascade' }),
    sceneId: uuid('scene_id').references(() => scenes.id),
    turnId: uuid('turn_id').references(() => turns.id),
    /** narrator, author, hints, fold or setup. */
    role: text('role').notNull(),
    model: text('model').notNull(),
    thinking: text('thinking').notNull(),
    /** The tokens the writer counted in what it sent, before sending. */
    estimate: integer('estimate').notNull(),
    /** What the model says it used. */
    input: integer('input').notNull().default(0),
    output: integer('output').notNull().default(0),
    cacheRead: integer('cache_read').notNull().default(0),
    cacheWrite: integer('cache_write').notNull().default(0),
    /** stop, length, error or aborted. */
    stopReason: text('stop_reason').notNull(),
    error: text('error'),
    startedAt: at('started_at').notNull(),
    endedAt: at('ended_at').notNull(),
  },
  (t) => [index('calls_book_idx').on(t.bookId, t.startedAt), index('calls_user_idx').on(t.userId, t.startedAt)],
);
