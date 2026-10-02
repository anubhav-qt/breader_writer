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

Nothing is built yet. We are settling the design with the owner, one question at a time.

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
- **Progress is words written against a length goal.** At setup you pick a length (short story,
  novella or novel). The bar is words written over that goal, and the story paces its arc to end
  near it, so a full bar means a finished book.
- **The AI is a hard fork of pi, the way Seelie is in POM** (see below). We fork the generalized
  harness and change it for our use. Models come from the owner's subscriptions (Google
  Antigravity first, with ChatGPT Codex and Claude as other options) through CLIProxyAPI.

### Open (ask the owner one at a time, in roughly this order)

1. Who may use the AI: it runs on the owner's own subscriptions.
2. What you can type while playing (speech, actions, out of character requests, undo).
3. What a character and a world are made of in setup, and whether the story may add characters.
4. Where stories are stored, and whether writer shares breader's server and database.
5. Whether a finished book can go to the breader library to be read there.
6. The word counts behind short story, novella and novel.

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

Breader's code is dense in places. When we bring a piece over, we rewrite it to the standards
below rather than copying it as it is.

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
