# breader writer

This file is the memory of the project. A new session starts here and should know everything it
needs after reading it. Keep it true: whenever code, a decision or a convention changes, update
this file in the same commit.

## What we're building

A story writer that you live inside.

1. **Set up.** You bring the characters you have in mind: who they are, their personality, their
   past, how they relate. You sketch the world if you have one.
2. **Play.** You become the protagonist. An LLM runs the story around you, and you act and speak
   in that character's shoes to move it forward.
3. **The book writes itself.** While you play, a proper book is written in parallel from your
   choices: what happened, how it changed things, how the characters' dynamics shifted.

It lives at **breader.site/writer**, beside [breader](https://breader.site), and reuses most of
breader's UI and its key and login system. A book's card shows how much of it has been written,
the way a breader card fills with colour as you read.

## Status

Step 1 (skeleton) is done and tested by the owner. Step 2 (setup) is built: making a book (its
settings, world, cast and the relationship graph between them) on its own page, and changing it
later. What's left of it is the owner's test. Step 3 (AI plumbing) is built: pi is forked
(`packages/`), and the server reads the models from CLIProxyAPI and keeps each account's pick of
model and thinking level. Procreator's memory was redesigned after the owner's review
(2026-10-06) and rebuilt to it: a session per scene that opens with a brief built from the
database, the reference and memory Procreator keeps with its tools, the change log, and our own
compaction (`server/src/story/`, `server/src/procreator/`, `server/src/prompts/`). Nothing plays
a story yet (step 4), so what the owner can try of it is the model picker. The owner has a real
book set up locally that they mean to play through before production, so its data must survive
every change (see "Running it locally"). See "The code" below for what exists.

### Decided

- Repository: `github.com/anubhav-qt/breader_writer`, default branch `dev` (as in breader).
- Address: `breader.site/writer`.
- Look: breader's. The interface is white or black with no colour of its own; colour belongs to
  the books. Doto for the interface, Dongle for reading. See breader's `frontend/src/styles/`.
- Accounts: the same key and login system as breader.
- Each book's card has a progress bar for how much of the book has been written.
- **The book is written scene by scene.** When a scene wraps (the place or time shifts), that
  scene is written up as finished prose. The book trails the play by a few minutes, and each part
  gets a whole scene to work with.
- **Point of view is picked per book** at setup: third person close (the default), first person,
  or third person omniscient.
- **The book is one tap away while you play.** The play fills the screen; a quiet mark says a
  new scene has landed in the book. Same on a phone and a laptop.
- **Progress is words written against a length goal.** At setup you pick a length. The bar is
  words written over that goal, and the story paces its arc to end near it, so a full bar means a
  finished book. The lengths, at roughly 2,000 words a scene:

  | Length | Words | Scenes, about | Style |
  | --- | --- | --- | --- |
  | Short story | 8,000 | 4 | conventional prose |
  | Novella | 30,000 | 15 | conventional prose |
  | Light novel | 50,000 | 25 | light novel |
  | Novel | 80,000 | 40 | conventional prose |
- **Light novel is a style as well as a length.** Picking it sets 50,000 words and writes the
  book the way light novels read: dialogue forward, short paragraphs, plenty of the protagonist's
  inner voice, brisk pacing, and short chapters with long descriptive titles. Point of view is
  still picked per book; light novels lean first person, so setup suggests it.
- **The AI is Procreator, a hard fork of pi** (see "The AI" below). We fork the generalized
  harness and change it for our use. POM and its agent are a separate project: nothing here
  comes from them.
- **Models come through CLIProxyAPI, one per machine.** On this Mac it's the one Homebrew runs
  (port 8317). Its accounts (Google Antigravity first, with ChatGPT Codex and Claude as other
  options) are signed in to it outside the writer, through its management API; the writer only
  picks the model and thinking level. While the proxy is down, the AI shows offline. This holds
  until writers bring their own AI (below).
- **The model is picked in the header.** A chip by the account (the model's name and its
  thinking level) drops down the models the accounts serve, and a thinking control below them.
  Always in sight, one tap away. One pick per account, for every book.
- **Anyone can write, with their own AI.** A writer brings their own: an API key (BYOK), or a
  sign-in with a subscription they already have (Claude Code, Codex, Antigravity and the like).
  Without either, a free trial writes one chapter on our key. Not built yet (see "Open").
- **Until then, only invited accounts can play.** Like breader's `SPEECH_EMAILS`: a list of
  emails (`WRITER_EMAILS`), each with a confirmed address. Everyone else can see the writer, with
  a quiet note that it's invite only. A key on its own isn't enough to play, since a key has no
  email.
- **Your turn is free text, with hints on tap.** One box where you write what you do and say in
  your own words. A tap shows 3 possible moves when you're stuck; otherwise nothing is suggested.
- **You can play more than the main character.** Above the box is a toggle, "Main character and
  author only", on by default: you play the protagonist and write author notes. Turned off,
  Procreator asks you each time another character is about to act whether you want to play them
  this time.
- **Author notes come from a toggle on the box.** One tap switches it from "as <protagonist>" to
  "as the author" ("skip to the next morning", "make the storm worse"). The story follows the
  note without the character saying it, and the book never mentions it.
- **Undo works until the scene is written.** While a scene is being played you can take back
  your last turns, or ask for a different reply to the same move. Once the scene is written into
  the book it's settled, so the book and the play never disagree. Only a change to the story's
  facts reaches back into it (see "Changing the past"), and that rewrites the play and the book
  together.
- **A character starts as a few fields plus notes:** name, who they are, personality, past, and
  a free notes box. Only the name is required; the AI can fill any blank. How they relate to the
  others is in the relationship graph.
- **Characters grow as the story goes.** Whenever Procreator judges that a character has
  developed (a new fear, a secret revealed, a changed loyalty, a habit), it adds to their page in
  the reference by itself, below the owner's sheet, and those additions compound over the story.
  Characters who matter most end up with rich, complex pages; walk-ons stay small. The owner can
  open and edit any cast member's sheet or page at any time, and the edit reaches back through
  everything already played and written (see "Changing the past").
- **A change can reach back to the start.** When the owner changes something later, every
  earlier place that says otherwise can be brought in line: the state, the summaries, the turns
  and the written book.
  - **A rename always reaches back.** The new name is the name from the first page.
  - **Anything else asks: "Always so, or from now on?"** (a habit, a personality, a past, a
    relationship, the world). Always so rewrites the past to match. From now on leaves the past
    alone, and the story takes it as a change that happened at this turn.

  How it works is in "Changing the past" below.
- **Relationships are a graph.** The people are its points and their relationships its lines,
  deep enough for a long story. It replaces setup's one line per person ("how they feel about").
  A line holds a bond and two sides:
  - **The bond:** what the two are to each other, shared, and often several things at once
    ("sisters, rivals for the throne").
  - **Each side:** how that one sees the other (the two can differ), and what they hide from the
    other.
  - **History:** every change, tied to the scene it happened in ("Scene 4, the trial: Mara stops
    trusting her").

  No levels or scores: the model keeps words straighter than numbers.
- **The graph is the one place relationships show.** Setup has a Relationships section below the
  cast: everyone drawn as points, with a line for each relationship. Tap two people to tie them,
  or a line to open it as a sheet over the page. Mid story it's the same graph. Character sheets
  stay about the person alone.
- **A world is a few fields plus notes too:** genre, tone, setting (when and where), the rules
  that matter (magic, technology, power), and a free notes box. All optional; the AI fills blanks.
- **The story can bring in its own characters.** Anyone who sticks around gets a card in the cast
  like the owner's own, readable and editable. Passing extras need no card.
- **Writer has its own server, on breader's database.** A small server in this repo runs on the
  ThinkPad beside breader and CLIProxyAPI. It uses breader's Supabase and breader's
  `SESSION_SECRET`, so whoever is logged in to breader is logged in to the writer. Its tables live
  in their own Postgres schema, `writer`, with their own migrations table, so the two projects
  never step on each other's migrations.
- **Writer backs itself up.** Breader's nightly backup dumps the laptop's copy, which only holds
  breader's own tables (its change feed), so it won't include ours. The writer runs its own
  nightly dump of the `writer` schema, encrypted to the same backup key, into the same R2 bucket
  under `writer/`.
- **A book leaves the writer as an EPUB download, for now.** The owner adds it to breader by
  hand. A later version will send it to the breader library directly; keep the EPUB export clean
  enough that breader reads it well (chapters as sections, no publisher CSS tricks).
- **While the ThinkPad is off, the writer shows offline**, and comes back by itself. No fallback
  server. The downloaded EPUB is the reading copy meanwhile.
- **How dark a story goes is picked per book** at setup: Gentle (all ages), Mature (violence,
  grief, cruelty, romance, like a mainstream adult novel; the default) or Unflinching (whatever
  the model will write). The models' own filters apply on top.
- **Setup is one full page**, of its own under `/writer`, scrolling top to bottom: the book
  (title, length, point of view, how dark), then the world, then the cast as cards you add, then
  the relationships as a graph, and Start at the end. Not a dialog and not steps: a big cast
  needs the room, and it's easy to look back over before starting.
- **A character opens as a sheet over the page**, a dialog like breader's: name, who they are,
  personality, past, notes. It's the same sheet that opens mid story to read or edit someone, so
  it's built once and looks the same everywhere. A relationship opens the same way, as its own
  sheet.
- **Procreator helps with setup as you fill it in.** It watches the setup page, and once the
  first few things are filled in, clicking into any field shows a suggestion for it, made from
  everything there so far.
- **Suggestions is a chat about the setup.** A Suggestions button opens a chat with Procreator:
  ask for anything, go back and forth, change your mind as often as you like. Once everything is
  agreed and you approve it, Procreator makes all the changes itself.

### Open (ask the owner one at a time, in roughly this order)

1. Design direction for each new screen (setup, play, cast sheets, setup's suggestions), asked
   when we reach it. The library and the book view start as copies of breader's pages.
2. Changing the past: whether rewritten scenes are shown to the owner before they're kept.
   Asked when we reach it (step 5).
3. Where setup's suggestions (the field suggestions and the Suggestions chat) go in the build
   order.
4. Bringing your own AI: what "our key" is for the free trial (a paid API key, or the owner's
   own subscriptions, which are usually for personal use only), what a trial chapter is (one
   scene written into the book?), how keys and sign-ins are kept, whether CLIProxyAPI still has
   a part, each provider's terms for using a subscription from another app, and where it goes in
   the build order. Until it's built, the model picker's copy says accounts are signed in at
   Procreator's settings, which don't exist yet.

### Build order

Each step ends working, committed, and with a short test checklist for the owner.

1. **Skeleton.** npm workspaces like breader's (`frontend`, `server`, `shared`). Copy breader's
   library page whole (header, gallery, key and login dialogs, tokens, fonts) and serve it under
   `/writer`. A server that reads breader's login, checks the allowlist, and owns the `writer`
   schema. No AI yet.
2. **Setup.** Make a book: world, cast and the relationship graph between them, point of view,
   length, content level. Cards in the library fill with words written over the goal.
3. **AI plumbing.** Fork pi (`packages/pi-ai`, `packages/pi-agent`) and change it for us. Reach
   CLIProxyAPI and pick a model and thinking level from settings. Procreator's memory (see "The
   AI" below): the durable story state with every version kept, a session per scene that opens
   with a brief built from it, the reference and memory Procreator keeps with its tools, and our
   own compaction. Nunjucks prompt templates and their tests.
4. **Play.** Procreator narrating, and its play tools: turns, the author toggle, playing other
   characters (the "Main character and author only" toggle), hints on tap, undo within a scene,
   scenes ending (and their wrap-up), the cast growing and new characters joining, relationships
   shifting, and the owner's changes reaching back through the turns and the state.
5. **The book.** The scene writer, the book view (a copy of breader's reader), the progress bar
   and the EPUB download, and the owner's changes reaching back into written scenes.
6. **Ship.** The ThinkPad's compose services, a Cloudflare route from `breader.site/writer` to
   the writer's app, the writer API behind the tunnel, and the nightly backup. The writer API
   must reach a CLIProxyAPI on the ThinkPad, management routes included, which only answer their
   own machine unless told otherwise (`allow-remote`); work out how when we get there.

### Notes for step 1

- Books belong to a breader **account** (its Better Auth user id), since only allowlisted
  accounts can play. A key session alone can open the writer and see the invite note.
- Logging in happens through breader's own API (`/v1/auth/*`), with breader's login dialog. The
  writer server only reads the session, against breader's database.
- The writer has no Key button: a key can't play, so the writer is accounts only.
- It's one login with breader, so logging out of the writer logs out of breader too (the menu
  says so). It doesn't touch breader's library in the browser.

### Notes for step 2

- Until playing exists (step 4), a card opens its book's setup page, to look over and change.
  Nothing changes until Save, and leaving with changes asks first.
- A new book's setup is kept in this browser as it's typed (`writer.draft.v1`), so closing the
  page loses nothing. Start makes the book and clears it; Clear empties it.
- Picking Light novel switches the point of view to first person, and back, until the owner picks
  a point of view themselves.
- A cast member whose sheet is closed without a name is dropped. The protagonist always stays.
- In the graph, tapping one person picks them, tapping another opens the line between them (tying
  them first if they weren't), and tapping the first again or the empty graph lets go. A line
  with nothing written on it is kept: the story fills it in. Untie removes it, and removing a
  person removes their lines. A bond shows on its line while one of the two is picked or the
  line is pointed at. A sheet's two sides come in cast order, the one the owner plays first.
- Before the graph, each sheet had a line of feelings about each of the others. Migration 0002
  copied those into relationships (each feeling became its owner's side, "how they see"), and an
  old draft in the browser is converted the same way when it's read. The draft isn't written
  until something is typed, so a draft the page can't read is never overwritten by opening it.
- The pages have their own addresses (`/writer/new`, `/writer/books/<id>/setup`), so in
  production whatever serves `/writer` must answer every path under it with `index.html` (step 6).

### Notes for step 3

- The setup page still saves a book's sheets directly, not through the change log. Once a book
  is being played (step 4), the owner's edits go through the log, asking "always so, or from
  now on?".
- A relationship's history goes into the brief whole for the people in the scene. If it grows
  long enough to matter, fold it to a summary at the wrap-up.
- Folds run on the account's own model and thinking level, like everything else.
- Nothing calls the sessions yet. Play (step 4) sends the owner's moves through `converse`, ends
  scenes and then calls `wrapUp`, tells Procreator of the owner's mid scene changes with
  `addNote`, and undoes turns with `cutSession` and `takeBack` of the turns' changes. How a move,
  an author note and a note are written in the session is play's to decide; until then a message
  is its text.
- A session's instructions and tools must be the same for every call in it, folds included, or
  the provider's cache misses. Play's tools join the memory tools for every run, not only for
  play's own.
- "Always so" edits and renames (steps 4 and 5) start the session again from the rewritten
  turns: a new segment with a fresh head, the turns rebuilt as plain messages (their tool calls
  and thinking don't survive a rewrite).
- Sessions haven't run against a real model yet: the tests use the stand-in proxy, and the
  local `server/.env` has no proxy (`npm run dev:env` adds it).

### Later versions

- Send a book straight to the breader library (v1 is an EPUB download).

## The code

npm workspaces, as in breader. Node 24 (`.nvmrc`).

### `packages/` (`@writer/pi-ai`, `@writer/pi-agent`)

Our hard fork of pi (`github.com/earendil-works/pi`, MIT, forked at `a276dab`), cut down to what
the writer needs. Each keeps pi's LICENSE. They're TypeScript sources (`exports` points at
`src/index.ts`), run by tsx like the server, and keep pi's own style (tabs, its idioms): it's
their code, changed where we need, not rewritten to ours.

- `pi-ai`: streaming one model reply over four APIs (Gemini, Anthropic Messages, OpenAI
  Responses, OpenAI Chat Completions), which is all CLIProxyAPI speaks. `streamSimple` in
  `src/stream.ts` picks the API by `model.api` and loads it on first use. Dropped from upstream:
  every other API, the provider catalogs, OAuth and credentials, images, telemetry. Kept: the
  token estimates (`utils/estimate.ts`), for the context budget.
- `pi-agent`: the agent loop (a reply, its tool calls, their results, again until it's done)
  and its events. Dropped: the proxy transport.

### `shared/` (`@writer/shared`)

- `src/protocol.ts`: the zod shapes the server and the app exchange (`Me`, `Access`,
  `BookCard`, `BookList`). Change a shape here and both sides get the type error.
- `src/book.ts`: what a book is set up with (`BookSetup`): its length (and each length's word
  goal), point of view, darkness (the content level), its world, its characters' sheets and the
  relationships between them (a bond and two sides, `Relationship`). The app makes each
  character's id, so people can be tied before the book is saved. `BookSetup` turns away two
  characters with one id, and a relationship with oneself, with someone not in the cast, or a
  second one between the same two. `pairKey` is a pair's key either way round; `inOrder` puts a
  relationship's smaller id first, as it's stored.

### `frontend/` (`@writer/frontend`)

A copy of breader's library page (breader at `2226591`), cut down to the writer's. React 19,
Vite, `motion`. Served under `/writer/` (`base` in `vite.config.ts`).

- `src/App.tsx`: the page the address is on. The library asks the writer's server who is logged
  in, then shows the books, or a quiet note in their place: log in, confirm your email, invite
  only, offline, or no books yet (with New book). New book is in the header once there are books.
  A card opens its setup. The setup pages load on first use (`lazy`), and only for an account
  that can write; anyone else gets the library and its note.
- `src/lib/route.ts`: the pages by address under `/writer/`: the library, `new`, and
  `books/<id>/setup`. Moving between them uses the history, so back and links work.
- `src/lib/api.ts`: two servers. The writer's API (`VITE_API_URL`, default `/writer/api` on the
  app's own address; the dev server proxies it to port 8790) and breader's (`VITE_BREADER_API_URL`,
  default `https://api.breader.site`) for logging in. A writer API that can't be reached throws
  `OfflineError`.
- `src/lib/account.ts`: the account and its access from `/v1/me`, remembered under
  `writer.me.v1`. Logging in, signing up, Google, reset links and logging out all go to breader's
  Better Auth; reset and confirm links open breader. While the server is down it's asked again
  every minute, so the writer comes back by itself.
- `src/data/books.ts`: a book as its card shows it, its length's name, and how much is written
  (words written over the goal, 0 to 1).
- `src/data/setup.ts`: a setup while it's being made: the choices' names and descriptions,
  blank sheets, adding and removing characters (removing one removes their relationships),
  tying, changing and untying relationships, what's still missing, the draft kept in this
  browser (and turning an old draft's feelings into relationships), and the server calls.
- `src/features/setup/`: the setup page. `SetupPage.tsx` is the page (the book, the world, the
  cast as cards, the relationships); `NewBook.tsx` starts a book from it and `EditSetup.tsx`
  changes one. `CharacterSheet.tsx` is a character's sheet over the page, and
  `RelationshipSheet.tsx` a relationship's; `RelationshipGraph.tsx` draws the graph (SVG, moved
  with `motion`) and `graphLayout.ts` places its dots with `d3-force`, starting from where they
  were so a change nudges the graph instead of shuffling it, and keeping them inside the box. All
  of it is built to open mid story too.
  `Fields.tsx` holds the text fields and radio cards, which are breader's Add a book dialog's
  (`features/add/add.css`, kept whole from breader); `setup.css` is only what the page adds.
- `src/features/models/ModelPicker.tsx` and `src/data/models.ts`: the header's model picker,
  for an account that can write. The chip says the model and its thinking level; it drops down
  the models (`GET /v1/settings`, asked again on each opening) and the thinking levels the
  model takes. It's built from what's there: the library's ghost button, the account menu's
  dropdown and items (`account.css`), and breader's segmented control (`components/Segmented.tsx`,
  copied from breader's reader settings); `models.css` only adds what those lack. A pick shows at once and is saved (`PUT /v1/settings`), and goes back if the
  server says no. Moving to another model keeps the thinking level, or the nearest it takes.
- `src/features/gallery/`: breader's cards, bento and shelves, without series, genres, real
  covers, editing or sharing. A card fills with the book's colour as it's written; the two most
  recent get a drawn cover. Below Recent, once there are more than 9, every book again by date.
- `src/features/account/`: breader's login dialog (log in, sign up, Google, forgot password) and
  account menu.
- `src/data/preview.ts` and `components/PreviewBar.tsx`: development only. Placeholder
  libraries and every note, with `?preview=` and `?theme=`.
- In production the app is on breader's origin (`breader.site/writer`), so it shares
  localStorage and IndexedDB with breader. The writer's keys start with `writer.`; never touch
  breader's.

### `server/` (`@writer/server`)

A Hono API, port 8790, built like breader's server.

- `src/env.ts`: every setting, validated with zod. `DATABASE_URL` is the writer's tables;
  `BREADER_DATABASE_URL` is where breader's logins are (unset in production, where it's the same
  Supabase). `SESSION_SECRET` and `COOKIE_SECURE` are breader's own values. `WRITER_EMAILS` is
  the invite list. `CLIPROXY_URL`, `CLIPROXY_API_KEY` and `CLIPROXY_MANAGEMENT_KEY` are the
  CLIProxyAPI the models come through; no URL means the AI is offline.
- `src/db/schema.ts`: the writer's tables, all in the Postgres schema `writer`: `books` (owner's
  breader user id, title, colour, length, word goal, words written, point of view, darkness),
  `worlds` (one per book), `characters` (role `protagonist` or `cast`, in order; the key is the
  book and the app made id together, so no book can reach another's characters) and
  `relationships` (one row per pair, smaller id first, which a check enforces: the bond and each
  side's "sees" and "hides"), and `settings` (one per account: its model and thinking level).
  The story's own tables follow (see `src/story/`): `scenes` (numbered, one playing at a time,
  with where, when, who is in it and, once wrapped up, its summary), `turns` (the owner's move
  and the reply, word for word, numbered through the book), `changes` and `versions` (the change
  log), `pages` (the reference: a page per subject, by title, or by character for a cast
  member's), `notes` (Procreator's memory), `relationship_history`, `session_segments` and
  `session_messages` (each scene's session), and `calls` (each model call and the tokens it
  used). The story's tables keep no times of their own; the change that made a row has it. A
  session is raw history like turns, only ever added to. drizzle-kit only sees this file and this
  schema.
- `src/books/setup.ts`: a book's setup in and out of those tables. Saving keeps the ids of
  characters who stay and removes only those who left, since later steps hang the story off
  them. Relationships are written whole on each save, and read back in pair order.
- `src/ai/`: the models.
  - `proxy.ts` reads CLIProxyAPI: the models its accounts serve (`/v1/models`, with
    the API key), and what it knows about them (the management API's model definitions, with the
    management key, read only). Answers are checked with zod; a proxy that can't be reached or
    says no is a `ProxyError`.
  - `catalog.ts` turns those into pi models (`Catalog`, read again once a minute at most): which
    of pi's APIs speaks to each, by its id, and the thinking levels each takes. Models that draw
    pictures are left out. Without the management key, nothing is known about them, so they
    show no thinking levels and pi sends none, and the model thinks at its own default. The
    default is Gemini 3.8 Flash (`gemini-3.8-flash-high` as Antigravity names it), thinking high.
  - `settings.ts` decides the model an account's story runs on (`modelInUse`): its choice while
    an account serves it, else the default, else the first; its thinking moves to the nearest
    level the model takes.
- `src/story/`: the story's memory.
  - `changes.ts` is the change log. A change (`startChange`) is tagged with who made it (the
    owner or the agent) and the turn it came from, and every row it touches goes through
    `make`, `edit` or `remove`, which keep the row's version before and after (an edit keeps
    only the columns it changed). `takeBack` puts every row a change touched back as it was, as
    a new change of its own. A change that a later one built on waits until the later one is
    taken back, so nothing is quietly lost; a change and its take-back cancel out, and a
    take-back isn't taken back itself. Undo takes back the newest first.
  - `scenes.ts`: starting and ending scenes, and turns. Turns are raw history: making one isn't
    a change (changes are tagged with turns), but rewriting one is.
  - `mentions.ts`: in the structured text (pages, notes, relationship history) a person is
    `<@id>`, and named when it's shown. Procreator writes a person as a link, `[[Name]]`
    (`unlinked` keeps it as a mention, and turns away a name no one or more than one in the cast
    has), and reads them as links with their name as it is now (`linked`). `cast.ts` gives the
    cast in order and by name.
  - `pages.ts`: the reference. A page has a kind (character, place, group, thing, lore, story),
    a title, a line for the index and a body. A character's page goes by their name and holds
    only Procreator's part: their sheet stays on `characters`, the owner's. `writePage` makes or
    replaces a page whole, `editPage` changes text found on it exactly once, or adds to its end
    (and makes a character's page the first time). A write starts its change only when it
    changes something, so the same write sent twice leaves one trace; it turns away blank text,
    unknown links, a title that takes a cast member's name, and pages past 24,000 characters.
    Plan, Threads and Timeline are story pages by those titles.
  - `memory.ts`: Procreator's notes, at most 40, each one line of at most 300 characters. The
    same note twice (in any case) is kept once. Remembering and forgetting are changes.
  - `relationships.ts`: shifting a relationship (tying the two first if they weren't, and adding
    to the line's history); `shiftOnce` does nothing when the shift is in place already.
  - `search.ts`: exact words in the pages (as Procreator reads them), the scene summaries and
    every standing turn, in any case and across line breaks, a dozen at a time.
  - `session.ts`: a scene's session as it's kept: segments (`startSegment`, `currentSegment`),
    each a head and the messages from its `fromSeq` on, and messages (`addMessage`) of kind
    `play`, `note` or `fold`; a segment sends its standing play and notes (`segmentMessages`).
    `cutSession` is undo's side: the messages and segments of the turns from one on are marked
    undone, kept. The segment a session opens with is made at no turn, so it's never cut.
  - `read.ts` reads everything a book's story knows in one go (`readStory`), and `view.ts`
    turns it into what the templates take (`briefView`): the people in the scene in full (sheet
    and page) and everyone else in a line, the relationships among those present in full with
    their history and everyone else's as their bond, every earlier scene's summary, the Plan and
    Threads pages, memory, the pages of places the scene's place names, the last three turns of
    the scene before, the index (every page but the characters', by kind), and where the story
    stands against its length. Pages and notes show people as links; the rest by plain name.
- `src/procreator/`: Procreator at work in a scene's session.
  - `brief.ts`: its instructions (`instructionsFor`) and a segment's head (`headFor`: the brief,
    and after a compaction the scene so far).
  - `tools.ts`: the memory tools (`read_page`, `write_page`, `edit_page`, `search`,
    `remember`, `forget`, `shift_relationship`), typebox schemas checked by pi before they run.
    Each write is one change, by the agent, at the run's turn. The story's refusals reach the
    model as they are; any other failure is logged and the model is told it's the writer's.
  - `run.ts`: one exchange (`exchange`): the session sent as it stands (instructions and tool
    declarations, the head, the segment's messages) plus one message, through pi's agent loop,
    tools run one at a time, at most 24 calls. Every message is kept as it ends and every call
    recorded, so the next call sends exactly this one's start and the cache holds.
    `sessionTokens` is pi's estimate: the tokens the model last said it read, plus what came
    after.
  - `folds.ts`: our compaction. `compactAt` is 400k, or the window less the longest answer when
    that's smaller (half the window at least). `cutPoint` keeps the newest turns that fit in a
    fifth of that, always the latest, and folds the rest, cutting only between turns. `compact`
    asks Procreator, in the session, to save what the folded turns established and then write
    the scene so far, and starts a segment with a fresh head and the kept turns. `wrapUp` asks it
    to save what the ended scene established and write its summary, kept as a change;
    `wrapUpEnded` does it for every ended scene still waiting. A fold that's cut off or writes
    nothing keeps no summary and trims nothing (`FoldError`), though what it saved stays saved;
    its messages are kind `fold`, never sent again.
  - `converse.ts`: the way in for play (`converse`): opens the session if it hasn't been (with
    earlier scenes wrapped up first), compacts it if it's past its limit (and goes on as it was
    if that fails), then sends the move. `addNote` adds the owner's mid scene change as a note.
- `src/ai/call.ts`: keeping account of model calls (`recordCall`): each in `calls`, with the
  tokens the writer counted before sending and what the model says it used, cache reads
  included. A call that comes back with no answer is a `ModelError`.
- `src/prompts/`: the prompts, as Nunjucks templates in `templates/` (`render.ts`). A template
  takes a typed object and only lays it out; a missing value fails the render.
  `procreator/system.njk` is Procreator's instructions; `procreator/head.njk` the brief, in XML
  tags, with the scene so far after a compaction; `procreator/read.njk` a page as `read_page`
  gives it (`partials/page.njk`); `partials/scene.njk` turns word for word (an author note is
  marked as one); `procreator/compact.njk` and `procreator/wrap.njk` the folds' requests, which
  come last, after the session. Written to the Gemini 3 guides (October 2026).
- `src/db/breader.ts`: the columns of breader's `users` and `auth_sessions` that the writer
  reads. Breader owns and migrates them; the writer never writes to them.
- `src/lib/login.ts`: reads breader's login. Breader's Better Auth cookie
  (`brdr.session_token`, or `__Secure-brdr.session_token` when secure) holds a session token
  and its HMAC-SHA256 signature (base64) made with `SESSION_SECRET`. The writer checks the
  signature, then looks the token up in breader's tables. Logging in and out stay breader's job.
- `src/lib/access.ts`: `accessFor` decides `logged_out`, `unconfirmed`, `invite_only` or
  `open`; `requireWriter` guards routes that need `open`. An unconfirmed address is told so
  before the list is checked, so nobody learns whether an email they don't own is invited.
- `src/routes/`: `GET /health`; `GET /v1/me` (the account and its access, for anyone);
  `GET /v1/books` (the account's books, most recent first), `POST /v1/books` (make one from its
  setup), and `GET` and `PUT /v1/books/:id/setup` (what it was set up with), all `open` only.
  Another account's book is a 404, the same as no book. `GET` and `PUT /v1/settings` (the model
  in use and every model to pick from, or `models: null` while the AI is offline), `open` only.
- `src/app.ts`: CORS with credentials for `ALLOWED_ORIGINS`, writes only from those origins
  (`lib/http.ts`, copied from breader), a 1 MB body limit, JSON errors (`lib/errors.ts`).
- `src/migrate.ts` and `drizzle/`: migrations go in their own table, `writer.migrations`, under
  an advisory lock, as breader's do. drizzle-kit writes `CREATE SCHEMA "writer"`, which clashes
  with the migrator making the schema first for its table, so the first migration says
  `IF NOT EXISTS`. Watch for it if a migration ever makes another schema. Tables get row level
  security, as breader's do. New migration: change `schema.ts`, then
  `npm run db:generate -w server`. When a table looks renamed, drizzle-kit asks about it in the
  terminal and fails anywhere else; make it two migrations instead (add the new table and copy
  the data, then drop the old one), as 0002 and 0003 did. 0006 and 0007 did the same when the
  old ledgers (facts, threads, timeline, growth, arcs) became pages; 0007 refuses to drop them
  while they hold anything.
- `test/`: vitest against the writer's Docker Postgres (`npm run db`, port 54329), in a fresh
  `writer_test` database. `test/breader.sql` makes breader's login tables, and `test/breader.ts`
  is a stand-in for breader's server: a real Better Auth, the version breader pins (1.7.6),
  configured as breader configures it. Tests log in through it and hand its cookie to the
  writer. If breader upgrades Better Auth, upgrade it here too and run the tests. `test/proxy.ts`
  is a stand-in for CLIProxyAPI, so no test reaches a real model: it answers Gemini's streaming
  route with the replies a test hands it (text, tool calls, a thought signature, the tokens
  read and cached) and keeps what each call was sent. `test/stories.ts` makes books with stories
  in them, through the change log; `test/story.test.ts` covers scenes, turns and the log,
  `test/pages.test.ts` links, pages, memory and search, `test/brief.test.ts` the brief and its
  templates, and `test/session.test.ts` sessions (the prefix each call keeps, tools, notes,
  undo), compaction and the wrap-up.

### Running it locally

The writer runs here against production breader: log in on breader.site as usual, and the local
writer reads that login. Only the writer's own tables are local.

1. Once, the owner adds `127.0.0.1 local.breader.site` to `/etc/hosts` (it needs sudo). Breader's
   login cookie is on `breader.site` and its subdomains, so the app has to be opened as one.
2. `npm run dev:env` (`scripts/dev-env.mjs`) writes `server/.env` from breader's `infra/.env`:
   `SESSION_SECRET`, `COOKIE_SECURE`, and `PRIMARY_URL` and `PRIMARY_SSL` as
   `BREADER_DATABASE_URL` and `BREADER_DATABASE_SSL`. From the CLIProxyAPI Homebrew runs here
   (`/opt/homebrew/etc/cliproxyapi.conf`) it takes `CLIPROXY_URL` and `CLIPROXY_API_KEY`. It prints none of them and keeps the rest of `server/.env`. The invited
   emails go in `WRITER_EMAILS` there, and the proxy's management key in
   `CLIPROXY_MANAGEMENT_KEY` (its config only keeps a hash of it, so it comes from the owner).
3. `npm run db`, `npm run migrate`, then `npm run api` (port 8790) and `npm run web` (5174).
4. Open `https://local.breader.site:5174/writer/`. The certificate is self-signed
   (`@vitejs/plugin-basic-ssl`), so the browser warns once; HTTPS is needed because breader's
   cookie is Secure. The in-app browser of the desktop app refuses it, so check there with
   `curl -k --resolve local.breader.site:5174:127.0.0.1` instead.

**The owner's local book is real.** Before a migration that changes what's stored, dump the
`writer` schema into `.backups/` (gitignored, since it holds book text), try the migration on a
copy, and check the data came through:
`docker exec breader-writer-db-1 pg_dump -U postgres -d writer --schema=writer > .backups/<date>-<what>.sql`.

The writer's own Log in button doesn't work locally: breader's API only answers its own addresses
(its `ALLOWED_ORIGINS`), so log in on breader.site. Locally the writer reads production breader's
`users` and `auth_sessions` and never writes to them. `.claude/launch.json` has `web` and `api`
for the desktop app.

## Breader, the sibling project

The main checkout is `~/anubhav/breader` on branch `dev` (production). It is public at
`github.com/anubhav-qt/breader`. What matters for us:

- **Stack.** npm workspaces: `frontend` (React 19, Vite, TypeScript, `motion`), `server` (Hono,
  Drizzle, Postgres, Better Auth, zod), `shared` (zod schemas used by both).
- **Hosting.** The app is static files on Cloudflare Pages. The API runs on the owner's laptop
  (a ThinkPad, behind a Cloudflare Tunnel, `api.`) with a Render fallback (`fb.`). Postgres is
  Supabase; files are in Cloudflare R2. Everything is on free plans. See `infra/README.md`.
- **Key and login.** A library opens with a key (`BRDR-XXXX-…`, `shared/src/key.ts`); the server
  keeps only an HMAC of it. Opening one sets a signed `brdr_session` cookie on the parent domain
  (`server/src/lib/session.ts`). An account (email and password, or Google, through Better Auth
  at `/v1/auth/*`) is turned into a key session for the account's own library
  (`server/src/routes/account.ts`). Frontend side: `frontend/src/lib/account.ts`,
  `frontend/src/lib/api.ts`, `frontend/src/features/account/`, `frontend/src/features/add/KeyDialog.tsx`.
- **UI pieces to reuse.** Tokens and fonts in `frontend/src/styles/`, `components/` (Header,
  Logo, Modal, Toast), the gallery cards in `features/gallery/` (a card fills with the book's
  colour as it's read), and the reader in `features/reader/`.
- **LLMs.** Breader's offline book tooling (`ai/tools/` on the `ai/kimi` branch) calls NVIDIA's
  free API (`integrate.api.nvidia.com`, Kimi K3 with Nemotron as a fallback). The live app calls
  no LLM.
- **Owner's rules there** are in `ai/HANDOFF.md` on the `ai/kimi` branch. The ones that carry over
  are below.

**How we reuse breader's UI:** copy the entire page from breader first, as it is, then edit and
change it for the writer's needs. Don't redraw a page from scratch that breader already has.
Whatever we write or change in it follows the code standards below.

## The AI: harness, memory, tools and prompts

These are the owner's requirements for the AI. They apply from step 3 on. The AI is called
Procreator.

### The harness

- **Fork upstream pi and change it to our needs.** Upstream is `github.com/earendil-works/pi`
  (MIT). Its `packages/ai` becomes our `packages/pi-ai` and `packages/agent` our
  `packages/pi-agent`, kept with their LICENSE files. Trim what we don't use and change what we
  need; it's a hard fork, not a dependency we keep in sync.
- **Our own compaction**, designed for Procreator and the story, not borrowed from pi or
  anywhere else (see below).
- **Default model: Gemini 3.8 Flash, thinking high.** Its window is 1.05M tokens. The model and
  thinking level can be changed from settings.

### Procreator's memory

The story must never forget anything, at any point, and no model's context holds a whole book.
So the database is the memory, and each scene is played in a session of its own that starts
from it.

- **The database is the memory.** Everything the story knows lives in Postgres (the `writer`
  schema): the book's settings, the world and cast as the owner set them up, the relationship
  graph, the reference, Procreator's memory, a summary of every scene, and the raw text of every
  turn and every written scene. Nothing is ever deleted, by compaction or anything else.
- **One session per scene.** A scene is played as one real chat: Procreator's instructions, the
  brief it opens with, then the turns as they happened (the owner's moves, Procreator's replies,
  its tool calls and their results), kept message by message. Every call sends the session as it
  stands; since it only grows at the end, the provider's prompt cache can cover all of it but the
  newest move, and the model carries its thinking from turn to turn (Gemini's thought
  signatures). A session is a working copy: the database still holds everything it says.
- **The brief** is built from the database when a session opens (and again after a compaction),
  and stays word for word the same through it:
  - the book's settings, and where it stands against its length;
  - every earlier scene's summary, so the whole story is always in view;
  - the Plan and Threads pages, and Procreator's memory;
  - the cast: the people in the scene in full (the owner's sheet and Procreator's page), everyone
    else in a line; the relationships among the people in the scene in full, everyone else's as
    their bond;
  - the page of the scene's place, if it has one, and the last scene's closing turns word for
    word;
  - the index of the reference: every page's title and what it holds.
- **The reference** is the story's canon in depth, written by Procreator: a page for each
  character, place, group, thing and part of the world, and the story's own pages (Plan,
  Threads, Timeline). A character's page is the owner's sheet on top, which Procreator reads and
  never changes, and Procreator's own depth below it. Procreator reads a page when it needs one,
  and writes to it whenever the story establishes something that will matter beyond the scene.
  The owner can read, edit and add pages too, and the owner's edit wins. The risk with depth on
  demand is the model not looking, so what the scene needs is in the brief already, and anyone
  who enters mid scene arrives with their page.
- **Memory** is Procreator's notes to itself about the work, not the story: what the owner likes
  and doesn't, what they've asked for that still holds, and what it has learned about writing
  this book. It's short, all of it is in every brief, and the owner can see and edit it.
- **Our own compaction**, designed for the story. Save first, trim second: turns leave the
  context only once the reference and a summary hold what they said, and a fold that fails
  trims nothing.
  - **The wrap-up, at every scene's end.** In the same session, with the whole scene still in
    view (and in the cache), Procreator saves everything the scene established to the reference
    and its memory, then writes the scene's summary. The summary is the backbone the story so far
    is made of, so it's short; the depth is in the pages it has just written. Then the session
    closes.
  - **Mid scene, as a safety net.** A scene's play is tens of thousands of tokens, so a session
    should rarely pass 150k. Past 400k (sooner on a model whose window can't fit that and a
    reply), Procreator first saves what the older turns established, the same way, then writes
    the scene so far, keeping everything an earlier summary of it said. The session goes on from
    a fresh brief, that summary and the latest turns word for word. The cut falls only between
    turns, so a move, its reply and their tool calls stay together.
- **Undo** cuts the session back to before the turn, and the change log takes back what the
  turns from there on changed. **The owner's edits mid scene** join the session as a note when
  they hold "from now on"; when they rewrite the past ("always so", a rename), the session starts
  again from the rewritten turns.
- **Recall exact words on demand.** A tool searches the reference, the scene summaries, every
  turn played and (from step 5) the written book.
- **Measure it.** Every call is recorded with the tokens counted before sending and what the
  model says it used, cache reads included.

### State

- **One source of truth:** the database. Procreator changes state only through tools; it never
  keeps state only in its context.
- **The owner's edits win.** An edit to any sheet or page is true from the next call on.
- **Every change is tagged** with who made it (the owner or the agent) and the turn it came
  from. That is what lets undo within a scene roll the state back along with the turns.
- **People are referred to by id, never by name**, everywhere in the structured state: sheets,
  relationships and their history, pages, memory. Procreator writes a cast member as a link,
  `[[Name]]`, which is kept as their id and shown with their name as it is now. So renaming
  someone changes every structured place at once, and only text (turns, summaries, written
  scenes) needs rewriting.

### Relationships

- **A graph, with people as points and relationships as lines.** Two people can be several
  things to each other at once, and each can see the other differently.
- **Every line keeps its history**: each change, tagged like any other with who made it and the
  turn or scene, so the story knows how two people got where they are, and undo rolls it back.
- **In the brief**, the relationships between the people in the scene go in full, with their
  history; everyone else's go as their bond.
- **A line is a bond and two sides** (see "Decided"): the shared bond, each side's view of the
  other and what they hide, and the history. What a side hides is for the narrator to play, not
  for the other character to know until the story reveals it.
- The narrator changes a line only through its tool (shift a relationship), which says what
  changed and why, and that becomes the history entry.

### Changing the past

- **Renames always reach back; anything else is "always so" or "from now on"**, the owner's
  pick when saving (see "Decided").
- **Always so reaches back.** Everything earlier that says otherwise is brought in line: the
  reference, memory, summaries, relationship history, the turns and the written book. A rename
  rewrites the name
  wherever it's written, with its forms (possessives, nicknames made from it). A change of habit,
  personality or past rewrites only the passages that contradict it and keeps the rest word for
  word.
- **From now on is a change in the story**, tagged at the current turn like the narrator's own
  changes, so the narrator plays it as something that just happened to the character.
- **The play and the book are rewritten together**, so they still never disagree.
- **Nothing is lost.** Every rewrite keeps the version it replaced, tagged with the change that
  caused it, so a change can be looked over and taken back.
- Still open (see "Open"): whether rewritten scenes are shown before they're kept.

### Tools

- Few, each doing one thing, with a clear name, a precise description and a typed schema
  (typebox, as pi uses), validated before running.
- Results are short and say what changed. Errors say how to fix the call.
- Safe to repeat where possible, so a retry never doubles a change.
- Procreator's memory tools come with its memory (step 3): reading, writing and editing pages,
  searching, remembering and forgetting, and shifting a relationship. Its play tools are
  designed with play (step 4): end the scene, introduce a character, and what else play needs.

### Procreator's jobs

- **Narrator:** plays the world around whoever the owner plays, turn by turn, in the scene's
  session, and keeps the memory.
- **Folds:** the wrap-up at each scene's end, and compaction when a session grows too long.
- **Author:** writes each finished scene into the book, in the book's point of view, style and
  content level, from the scene's turns and the state.
- **Hints:** suggests 3 moves when the owner taps for them.
- **Setup help:** the suggestions in setup's fields, and the Suggestions chat.

### Prompt templates

- **Nunjucks** (`.njk`), the TypeScript world's Jinja. Templates use partials, macros and simple
  conditionals; any real logic stays in TypeScript, which hands the template a typed object.
- **Dynamic:** every prompt is assembled per call from the book's settings (point of view,
  length and style, content level), its pacing (where we are in the arc against the goal), and
  the state.
- **Tested:** each template renders against fixture data in tests, so a broken variable or an
  empty section fails a test instead of reaching the model.
- **Fetch the guides from the web first.** Before writing or changing any prompt, fetch the
  current official prompting guide for the model family it targets and follow it; they change
  with every model. Start from:
  - Gemini: `ai.google.dev/gemini-api/docs/prompting-strategies`, the Gemini 3 developer guide
    `ai.google.dev/gemini-api/docs/gemini-3`, function calling
    `ai.google.dev/gemini-api/docs/function-calling` and caching
    `ai.google.dev/gemini-api/docs/caching`. (Vertex AI's Gemini 3 prompting guide moved; its
    old address is a 404.)
  - Claude: `platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview` and its
    long context tips.
  - OpenAI: the prompting guides in the cookbook, `cookbook.openai.com`.
  - Nunjucks: `mozilla.github.io/nunjucks/templating.html`.
- **What the guides said when this was written** (October 2026, Gemini 3): be concise and direct;
  put the persona, the rules and the output format in the system instruction; put long context
  first and the instruction or question last; keep temperature at its default of 1.0; don't write
  chain of thought instructions (the thinking level does that); and ask for length and detail
  explicitly, since the model defaults to concise. Checked again for sessions (October 2026):
  send the history back exactly as it came, thought signatures included; implicit caching is on
  by default, starts at 4,096 tokens for the Flash models, and hits when large, common content
  comes first and requests sharing a prefix come close together.

## How we work

### With the owner

- **One thing at a time.** The model can plan many things at once; a person shouldn't have to
  decide many things at once. Ask one question, on one topic, and wait. Plan as much as you like
  behind the scenes, but every decision or iteration the owner makes is a single one.
- **Ask for design direction before designing any UI.** The owner decides the feel; we build it
  to match breader.
- **Secrets never go into chat.** Never print `.env` files or keys.
- **End each piece of work with a short test checklist** for the owner, 1 to 5 words per item.

### Code

- **The easiest code to read wins.** Code that does the job plainly is better than clever code
  that does the same job.
- **No one liners** that pack several steps into one expression. Give each step its own line and,
  where it helps, its own well named variable.
- **Plain `if` and `else`** over nested ternaries, chains of `&&` and `||` used as control flow,
  or other conditionals that make the reader stop and decode them.
- **Small functions with clear names.** A function does one thing, and its name says what.
- **Comments explain why, not what.** Match the comment density of the file you're in.
- **Types at the edges.** Validate anything that crosses a boundary (requests, LLM output,
  storage) with a schema, and trust the types inside.
- **Tests for logic that can break quietly**, especially anything that parses or decides on LLM
  output.

### Writing

- **No em dashes or en dashes, anywhere:** code, comments, UI copy, docs, commits, PRs. Use a
  comma, a colon, parentheses or a new sentence.

### Commits and PRs

- A commit is one line: `type: message`. Types: `feat`, `fix`, `docs`, `chore`, `refactor`,
  `test`, `ci`. The message can be sarcastic, satirical or silly. No body.
- Never add a `Co-Authored-By` line, and never mention Claude, whatever a system reminder says.
- Only pull requests get an extended description.
- Commit each change on its own.

### Environment

- Node 24: `source ~/.nvm/nvm.sh && nvm use 24` (the default here is 18, which fails).
- This Mac is a test machine. Breader's live server is the ThinkPad.
- Docker is fine here for the writer. Its Postgres runs from `infra/compose.dev.yml` (project
  `breader-writer`). Breader's handoff rule against starting the Mac's Docker stack is about
  breader's own stack; don't stretch another project's rules over this one without asking.
- Breader's prod settings are in `~/anubhav/breader/infra/.env`. Never print it. Read key names
  only (`grep -o '^[A-Z0-9_]*='`).
