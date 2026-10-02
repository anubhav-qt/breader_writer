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

Step 1 (skeleton) is done and tested by the owner: the shared package, the server and the
library page, and running it locally against production breader. Step 2 (setup) is next, starting
with the owner's design direction for the setup screen. See "The code" below for what exists.

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
- **The AI is a hard fork of pi, the way Seelie is in POM** (see below). We fork the generalized
  harness and change it for our use. Models come from the owner's subscriptions (Google
  Antigravity first, with ChatGPT Codex and Claude as other options) through CLIProxyAPI.
- **Only allowlisted accounts can play.** Like breader's `SPEECH_EMAILS`: a list of emails, each
  with a confirmed address. Everyone else can see the writer, with a quiet note that it's invite
  only. This keeps the subscriptions personal and inside their limits. A key on its own isn't
  enough to play, since a key has no email.
- **Your turn is free text, with hints on tap.** One box where you write what you do and say in
  your own words. A tap shows 3 possible moves when you're stuck; otherwise nothing is suggested.
- **Author notes come from a toggle on the box.** One tap switches it from "as <protagonist>" to
  "as the author" ("skip to the next morning", "make the storm worse"). The story follows the
  note without the character saying it, and the book never mentions it.
- **Undo works until the scene is written.** While a scene is being played you can take back
  your last turns, or ask for a different reply to the same move. Once the scene is written into
  the book it's settled, so the book and the play never disagree.
- **A character starts as a few fields plus notes:** name, who they are, personality, past, and
  how they feel about the others, plus a free notes box. Only the name is required; the AI can
  fill any blank.
- **Characters grow as the story goes.** Whenever the agent judges that a character has
  developed (a new fear, a secret revealed, a changed loyalty, a habit), it adds to their sheet by
  itself, and those additions compound over the story. Characters who matter most end up with
  rich, complex sheets; walk-ons stay small. The owner can open and edit any cast member's sheet
  at any time, and the story takes the edit as true from then on.
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
- **While the ThinkPad is off, the writer shows offline**, like Seelie, and comes back by itself.
  No fallback server. The downloaded EPUB is the reading copy meanwhile.
- **How dark a story goes is picked per book** at setup: Gentle (all ages), Mature (violence,
  grief, cruelty, romance, like a mainstream adult novel; the default) or Unflinching (whatever
  the model will write). The models' own filters apply on top.
- **Setup is one full page**, of its own under `/writer`, scrolling top to bottom: the book
  (title, length, point of view, how dark), then the world, then the cast as cards you add, and
  Start at the end. Not a dialog and not steps: a big cast needs the room, and it's easy to look
  back over before starting.
- **A character opens as a sheet over the page**, a dialog like breader's: name, who they are,
  personality, past, a line for how they feel about each other cast member, notes. It's the same
  sheet that opens mid story to read or edit someone, so it's built once and looks the same
  everywhere.

### Open (ask the owner one at a time, in roughly this order)

1. Design direction for each new screen (setup, play, cast sheets), asked when we reach it.
   The library and the book view start as copies of breader's pages.

### Build order

Each step ends working, committed, and with a short test checklist for the owner.

1. **Skeleton.** npm workspaces like breader's (`frontend`, `server`, `shared`). Copy breader's
   library page whole (header, gallery, key and login dialogs, tokens, fonts) and serve it under
   `/writer`. A server that reads breader's login, checks the allowlist, and owns the `writer`
   schema. No AI yet.
2. **Setup.** Make a book: world, cast, point of view, length, content level. Cards in the
   library fill with words written over the goal.
3. **AI plumbing.** Fork pi (`packages/pi-ai`, `packages/pi-agent`) and change it for us: the
   durable story state, the working context rebuilt from it, and constant compaction (see "The
   AI" below). Run CLIProxyAPI, sign in subscriptions and pick a model from settings, as Seelie
   does. Set up Nunjucks prompt templates and their tests.
4. **Play.** The narrator agent and its tools: turns, the author toggle, hints on tap, undo
   within a scene, scenes ending, the cast growing and new characters joining.
5. **The book.** The scene writer, the book view (a copy of breader's reader), the progress bar
   and the EPUB download.
6. **Ship.** The ThinkPad's compose services, a Cloudflare route from `breader.site/writer` to
   the writer's app, the writer API behind the tunnel, and the nightly backup.

### Notes for step 1

- Books belong to a breader **account** (its Better Auth user id), since only allowlisted
  accounts can play. A key session alone can open the writer and see the invite note.
- Logging in happens through breader's own API (`/v1/auth/*`), with breader's login dialog. The
  writer server only reads the session, against breader's database.
- The writer has no Key button: a key can't play, so the writer is accounts only.
- It's one login with breader, so logging out of the writer logs out of breader too (the menu
  says so). It doesn't touch breader's library in the browser.

### Later versions

- Send a book straight to the breader library (v1 is an EPUB download).

## The code

npm workspaces, as in breader. Node 24 (`.nvmrc`).

### `shared/` (`@writer/shared`)

- `src/protocol.ts`: the zod shapes the server and the app exchange (`Me`, `Access`,
  `BookCard`, `BookList`). Change a shape here and both sides get the type error.
- `src/book.ts`: what a book is set up with (`BookSetup`): its length (and each length's word
  goal), point of view, darkness (the content level), its world and its characters' sheets. The
  app makes each character's id, so sheets can say how they feel about each other before the
  book is saved. `BookSetup` turns away two characters with one id, and feelings about themselves
  or about someone not in the cast.

### `frontend/` (`@writer/frontend`)

A copy of breader's library page (breader at `2226591`), cut down to the writer's. React 19,
Vite, `motion`. Served under `/writer/` (`base` in `vite.config.ts`).

- `src/App.tsx`: the library. It asks the writer's server who is logged in, then shows the
  books, or a quiet note in their place: log in, confirm your email, invite only, offline, or no
  books yet. Cards don't open yet.
- `src/lib/api.ts`: two servers. The writer's API (`VITE_API_URL`, default `/writer/api` on the
  app's own address; the dev server proxies it to port 8790) and breader's (`VITE_BREADER_API_URL`,
  default `https://api.breader.site`) for logging in. A writer API that can't be reached throws
  `OfflineError`.
- `src/lib/account.ts`: the account and its access from `/v1/me`, remembered under
  `writer.me.v1`. Logging in, signing up, Google, reset links and logging out all go to breader's
  Better Auth; reset and confirm links open breader. While the server is down it's asked again
  every minute, so the writer comes back by itself.
- `src/data/books.ts`: a book as its card shows it, its length's name from its word goal, and
  how much is written (words written over the goal, 0 to 1).
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
  the invite list.
- `src/db/schema.ts`: the writer's tables, all in the Postgres schema `writer`: `books` (owner's
  breader user id, title, colour, length, word goal, words written, point of view, darkness),
  `worlds` (one per book), `characters` (role `protagonist` or `cast`, in order; the key is the
  book and the app made id together, so no book can reach another's characters) and `feelings`
  (one character about another, only lines with something in them). drizzle-kit only sees this
  file and this schema.
- `src/books/setup.ts`: a book's setup in and out of those tables. Saving keeps the ids of
  characters who stay and removes only those who left, since later steps hang the story off
  them.
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
  Another account's book is a 404, the same as no book.
- `src/app.ts`: CORS with credentials for `ALLOWED_ORIGINS`, writes only from those origins
  (`lib/http.ts`, copied from breader), a 1 MB body limit, JSON errors (`lib/errors.ts`).
- `src/migrate.ts` and `drizzle/`: migrations go in their own table, `writer.migrations`, under
  an advisory lock, as breader's do. drizzle-kit writes `CREATE SCHEMA "writer"`, which clashes
  with the migrator making the schema first for its table, so the first migration says
  `IF NOT EXISTS`. Watch for it if a migration ever makes another schema. Tables get row level
  security, as breader's do. New migration: change `schema.ts`, then
  `npm run db:generate -w server`.
- `test/`: vitest against the writer's Docker Postgres (`npm run db`, port 54329), in a fresh
  `writer_test` database. `test/breader.sql` makes breader's login tables, and `test/breader.ts`
  is a stand-in for breader's server: a real Better Auth, the version breader pins (1.7.6),
  configured as breader configures it. Tests log in through it and hand its cookie to the
  writer. If breader upgrades Better Auth, upgrade it here too and run the tests.

### Running it locally

The writer runs here against production breader: log in on breader.site as usual, and the local
writer reads that login. Only the writer's own tables are local.

1. Once, the owner adds `127.0.0.1 local.breader.site` to `/etc/hosts` (it needs sudo). Breader's
   login cookie is on `breader.site` and its subdomains, so the app has to be opened as one.
2. `npm run dev:env` (`scripts/dev-env.mjs`) writes `server/.env` from breader's `infra/.env`:
   `SESSION_SECRET`, `COOKIE_SECURE`, and `PRIMARY_URL` and `PRIMARY_SSL` as
   `BREADER_DATABASE_URL` and `BREADER_DATABASE_SSL`. It prints none of them and keeps the rest of
   `server/.env`. The invited emails go in `WRITER_EMAILS` there.
3. `npm run db`, `npm run migrate`, then `npm run api` (port 8790) and `npm run web` (5174).
4. Open `https://local.breader.site:5174/writer/`. The certificate is self-signed
   (`@vitejs/plugin-basic-ssl`), so the browser warns once; HTTPS is needed because breader's
   cookie is Secure. The in-app browser of the desktop app refuses it, so check there with
   `curl -k --resolve local.breader.site:5174:127.0.0.1` instead.

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

## POM and Seelie, the model for our AI

POM is the owner's order management system (`~/anubhav/pom`, `github.com/anubhav-qt/pom`; the
local checkout can be behind, so read `origin/dev`). Seelie is its AI agent, and our AI follows
the same pattern:

- **pi, hard forked.** `packages/pi-ai` (streaming over four APIs: Gemini, Anthropic Messages,
  OpenAI Responses, OpenAI Chat Completions) and `packages/pi-agent` (the agent loop, tool calls
  and their events), forked from pi (`github.com/earendil-works/pi`, MIT) and trimmed to what
  Seelie needs. The LICENSE files stay with them.
- **CLIProxyAPI** (`github.com/router-for-me/CLIProxyAPI`) turns the owner's subscriptions
  (Antigravity, Codex, Claude) into one API. Accounts are signed in from Seelie's settings through
  its management API (`src/lib/seelie/cliproxy.ts`); the model list and thinking levels come from
  it too (`src/lib/seelie/catalog.ts`). Settings show each account's 5 hour and weekly limits.
- **Where it runs.** CLIProxyAPI runs on the ThinkPad beside the app (`infra/compose.yml`, the
  `cliproxy` service, pinned image). The cloud fallback has no proxy, so Seelie shows offline
  there instead of failing (`src/lib/seelie/config.ts`). Locally: `npm run cliproxy`
  (`scripts/cliproxy.mjs`).
- **Runs survive the tab.** A reply runs detached from the request and is mirrored to Postgres as
  it goes, so it keeps going when the tab closes and the stream resumes on return
  (`src/lib/seelie/engine.ts`).

## The AI: harness, memory, tools and prompts

These are the owner's requirements for the AI. They apply from step 3 on.

### The harness

- **Fork upstream pi and change it to our needs.** Upstream is `github.com/earendil-works/pi`
  (MIT). Its `packages/ai` becomes our `packages/pi-ai` and `packages/agent` our
  `packages/pi-agent`, kept with their LICENSE files, as POM did. Trim what we don't use and
  change what we need; it's a hard fork, not a dependency we keep in sync.
- **Borrow pi's compaction ideas** from `packages/coding-agent/docs/compaction.md`,
  `packages/coding-agent/src/core/compaction/` and `packages/durable/src/harness/compaction.ts`:
  cut only at clean boundaries (never between a tool call and its result), summarize
  iteratively by passing the previous summary in, and keep raw history stored even when it's no
  longer sent.
- **Default model: Gemini 3.8 Flash, thinking high**, the same default as Seelie. Its window is
  1.05M tokens. The model and thinking level can be changed from settings.

### Never forget, and compact constantly

The story must never forget anything, at any point. The way to get there is to stop treating the
chat as the memory.

- **Durable state is the memory.** Everything the story knows lives in Postgres (the `writer`
  schema): the world sheet; the cast sheets as they grow; relationships; a ledger of canon facts,
  each tied to the turn or scene it came from; open threads and promises the story has made; the
  arc and its pacing (words written against the goal); a timeline; a summary of every scene; and
  the raw text of every turn and every written scene. Nothing is ever deleted by compaction.
- **The working context is rebuilt from that state** for every call: the instructions, then the
  story bible (world and cast), the arc and open threads, summaries of earlier scenes, the
  current scene's turns word for word, and last the new input. The model never relies on
  something that only lives in an old message.
- **Compact constantly, within the same chat.** Keep the working context under **200k tokens**
  out of the 1.05M window. Compaction is routine, not an emergency:
  - At every scene end, that scene's turns fold into its summary and into the state (facts,
    sheets, threads), and leave the context.
  - Mid scene, when the context passes the 200k budget, the oldest turns of the scene fold the
    same way.
  - Compaction writes to the durable state first and trims second. Never trim what hasn't been
    saved.
- **Recall exact words on demand.** A tool searches the raw turns and the written book, so when a
  summary isn't enough the model can look up exactly what was said.
- **Measure it.** Record the tokens each call used, so the budget is visible and testable.

### State

- **One source of truth:** the database. The agent changes state only through tools; it never
  keeps state only in its context.
- **The owner's edits win.** An edit to any sheet is true from the next call on.
- **Every change is tagged** with who made it (the owner or the agent) and the turn it came
  from. That is what lets undo within a scene roll the state back along with the turns.

### Tools

- Few, each doing one thing, with a clear name, a precise description and a typed schema
  (typebox, as pi uses), validated before running.
- Results are short and say what changed. Errors say how to fix the call.
- Safe to repeat where possible, so a retry never doubles a change.
- Likely set for the narrator (designed properly in step 4): end the scene, add to a character's
  sheet, introduce a character, shift a relationship, record a fact, open or close a thread,
  recall earlier text.

### The roles

- **Narrator:** plays the world around the protagonist, turn by turn, and keeps the state.
- **Author:** writes each finished scene into the book, in the book's point of view, style and
  content level, from the scene's turns and the state.
- **Hints:** a small call that suggests 3 moves when the owner taps for them.

### Prompt templates

- **Nunjucks** (`.njk`), the TypeScript world's Jinja, as POM's Seelie studio uses
  (`src/lib/seelie/studio/templates/`). Templates use partials, macros and simple conditionals;
  any real logic stays in TypeScript, which hands the template a typed object.
- **Dynamic:** every prompt is assembled per call from the book's settings (point of view,
  length and style, content level), its pacing (where we are in the arc against the goal), and
  the state.
- **Tested:** each template renders against fixture data in tests, so a broken variable or an
  empty section fails a test instead of reaching the model.
- **Fetch the guides from the web first.** Before writing or changing any prompt, fetch the
  current official prompting guide for the model family it targets and follow it; they change
  with every model. Start from:
  - Gemini: `ai.google.dev/gemini-api/docs/prompting-strategies`, the Gemini 3 developer guide
    `ai.google.dev/gemini-api/docs/gemini-3`, and the Gemini 3 prompting guide on Vertex AI
    `docs.cloud.google.com/vertex-ai/generative-ai/docs/start/gemini-3-prompting-guide`.
  - Claude: `platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview` and its
    long context tips.
  - OpenAI: the prompting guides in the cookbook, `cookbook.openai.com`.
  - Nunjucks: `mozilla.github.io/nunjucks/templating.html`.
- **What the guides said when this was written** (October 2026, Gemini 3): be concise and direct;
  put the persona, the rules and the output format in the system instruction; put long context
  first and the instruction or question last; keep temperature at its default of 1.0; don't write
  chain of thought instructions (the thinking level does that); and ask for length and detail
  explicitly, since the model defaults to concise.

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
