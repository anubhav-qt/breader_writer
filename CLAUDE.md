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

Nothing is built yet. The product questions are settled; building starts at step 1 of the build
order below.

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

  | Length | Words | Scenes, about |
  | --- | --- | --- |
  | Short story | 8,000 | 4 |
  | Novella | 30,000 | 15 |
  | Light novel | 50,000 | 25 |
  | Novel | 80,000 | 40 |
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
3. **AI plumbing.** Fork pi (`packages/pi-ai`, `packages/pi-agent`), run CLIProxyAPI, sign in
   subscriptions and pick a model from settings, as Seelie does.
4. **Play.** The narrator agent: turns, the author toggle, hints on tap, undo within a scene,
   scenes ending, the cast growing and new characters joining.
5. **The book.** The scene writer, the book view (a copy of breader's reader), the progress bar
   and the EPUB download.
6. **Ship.** The ThinkPad's compose services, a Cloudflare route from `breader.site/writer` to
   the writer's app, the writer API behind the tunnel, and the nightly backup.

### Notes for step 1

- Books belong to a breader **account** (its Better Auth user id), since only allowlisted
  accounts can play. A key session alone can open the writer and see the invite note.
- Logging in happens through breader's own API (`/v1/auth/*`), with breader's login dialog. The
  writer server only reads the session, against breader's database.

### Later versions

- Send a book straight to the breader library (v1 is an EPUB download).

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
