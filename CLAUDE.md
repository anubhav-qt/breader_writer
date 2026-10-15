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

The owner tests once everything is built, locally, before it goes to the ThinkPad (their call,
2026-10-07), so no step waits on their test: each still ends with a checklist, kept for that
pass. Step 1 (skeleton) is done and tested by the owner. Step 2 (setup) is built: making a book
(its settings, world, cast and the relationship graph between them) on its own page, and
changing it later. Step 3 (AI plumbing) is built: pi is forked (`packages/`), and the server
reads the models from CLIProxyAPI and keeps each account's pick of model and thinking level.
Procreator's memory was redesigned after the owner's review (2026-10-06) and rebuilt to it: a
session per scene that opens with a brief built from the database, the reference and memory
Procreator keeps with its tools, the change log, and our own compaction (`server/src/story/`,
`server/src/procreator/`, `server/src/prompts/`). It ran end to end against the real model the
same day (see "Notes for step 3"). Nothing plays a story yet (step 6). Step 4 (settings) is
built: in the model picker, the owner signs the proxy's AI accounts in and out, which needs the
proxy's management key in `server/.env` (only the owner has it). Every call now asks each
provider for its longest cache (see "Notes for step 3"). Step 5 (setup help) is under way:
Procreator's faint text in setup's fields is built, and since 2026-10-07 every blank field
shows it at once (see "Notes for step 5"). It was checked in the desktop app's browser against a
stand-in API, and both the field by field version and the blank fields all at once were tried
against the real model (the blank fields on 2026-10-15). The Suggestions chat is built: its server, tried against the real model
(2026-10-07), and its panel on the setup page, checked in headless Chrome against a stand-in API
(2026-10-15), so step 5 is done. Step 6 (play) is under way
(see "Notes for step 6"): breading_ground is the one door for story changes, and play's server
is built (the openings, moves narrated as they're written, scenes ending and going on, undo,
another reply, hints, someone joining the cast), and so are the cast's actors (cues, sending an
answer back, the owner playing others with the switch off, each actor's chat and its
compaction), with their tests against a stand-in proxy, and both were tried against the real
model on 2026-10-15 (see "Notes for step 6"). The play page is built (the prose, the pinned box, openings, cues, hints, undo,
another reply, a scene's end and going on), checked in headless Chrome against a stand-in API
(2026-10-11). The owner's edits mid story have their server (2026-10-11): what the Story panel
shows, and every change setup can make, held from now on and told to Procreator, or reaching back
(a rename, "Always so"), rewritten into what was played by Procreator and kept at once, with the
sessions and the actors' chats started again from it. A rename met the real model on 2026-10-15;
the other changes haven't yet. The
Story panel is built on it (2026-10-11), checked in headless Chrome against a stand-in API, and
so is the Notes panel (2026-10-15), with the owner's edits to pages and memory through the same
door. On 2026-10-15 the owner said to finish everything left without stopping for design
questions ("just finish it all, i will review, test and make more changes while using it"), so
the design calls from then on are ours, each marked so below. Step 7 (the book) is built
(2026-10-15, see "Notes for step 7"): each scene, once the owner goes on from it, is written up as
a chapter in the background, a story ends and the book is finished, the book view (breader's
reader, cut down) is a tap away from the play with a mark for a new chapter, the EPUB download,
and changes that reach back reach the chapters too. Its server has tests against a stand-in
proxy; the book view was checked in headless Chrome against a stand-in API, and the author was
tried against the real model on 2026-10-15. That run used up the owner's Antigravity limit for
Gemini 3.8 Flash, which resets on 2026-10-19 at 04:58 UTC; until then the owner plays on another
model or waits. Step 8 (ship) is written and checked here, not deployed (2026-10-15, see "Notes
for step 8"): the server's image, the laptop's compose stack beside breader's, the nightly backup,
the Worker that serves the app at `breader.site/writer`, and CI. Setting it up is the owner's, in
`infra/README.md`. The owner has a real book set up locally that they mean to play through
before production, so its data must survive every change (see "Running it locally"). See "The code" below for what exists.

### Decided

- Repository: `github.com/anubhav-qt/breader_writer`, default branch `dev` (as in breader).
- Address: `breader.site/writer`.
- Look: breader's. The interface is white or black with no colour of its own; colour belongs to
  the books. Doto for the interface, Dongle for reading. See breader's `frontend/src/styles/`.
- **Writing gets a feel of its own.** Breader is made for reading. Where the owner writes
  (setup's fields, the play box, sheets), the writer goes past breader: a better, richer text
  editor and input area, and a typeface that makes writing feel and look good in place of
  Dongle. The specifics are asked screen by screen. On the setup page (its fields, the
  Suggestions chat and the Writer's notes) it's Literata (the owner's pick, 2026-10-06), and in
  play too: its prose and the box for a move (the owner's pick, 2026-10-07).
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
  (port 8317). The owner signs its accounts in and out from the writer's settings (Google
  Antigravity first, with ChatGPT Codex and Claude as other options), through the proxy's
  management API; every writer picks the model and thinking level. While the proxy is down, the
  AI shows offline. This holds until writers bring their own AI (below).
- **The model is picked in the header.** A chip by the account (the model's name and its
  thinking level) drops down the models the accounts serve, and a thinking control below them.
  Always in sight, one tap away. One pick per account, for every book.
- **Settings live in the model picker.** Below the models and "For every book.", only the owner
  sees "AI accounts": every account signed in to the proxy (its kind, its email, and why it
  can't serve if it can't), each with Sign out and a confirm in place, then "Sign in:
  Antigravity, ChatGPT, Claude". The owner is whoever's email is in `OWNER_EMAILS`. Every other
  writer sees "Your AI" there instead, where they bring their own (see "Notes for step 9").
- **Anyone can write, with their own AI.** A writer brings their own: an API key (BYOK), or a
  sign-in with a subscription they already have (Claude Code, Codex, Antigravity and the like).
  Everyone's first chapter is free, on the owner's own Antigravity account (the one signed in to
  CLIProxyAPI): normal writing, nothing held back or marked as a trial. Once that chapter is
  done, the owner's account writes no more of the book, and going on needs the writer's own AI.
  Not built yet (see "Open").
- **Until then, only invited accounts can play.** Like breader's `SPEECH_EMAILS`: a list of
  emails (`WRITER_EMAILS`), each with a confirmed address. Everyone else can see the writer, with
  a quiet note that it's invite only. A key on its own isn't enough to play, since a key has no
  email. `OPEN_TO_ALL` (off by default) lets every confirmed account in (see "Notes for step 9").
- **The play reads like a book page** (the owner's pick, 2026-10-07). Procreator's narration
  flows as prose in one centred column, like a reader, and the owner's moves sit between its
  paragraphs as quiet italic lines. The box for a move is pinned at the bottom of the screen,
  always in view, and the prose scrolls above it (the owner's pick, 2026-10-07). The page holds
  only the scene being played, under its heading. When it wraps, the page starts fresh under
  the next scene's heading, and earlier scenes are read in the book (the owner's pick,
  2026-10-07, knowing the scene that just ended is gone from the play before the book has it).
  The narration comes in word by word as Procreator writes it, as the Suggestions chat's does;
  until its first words, while it thinks or asks the actors, a quiet line says it's working
  (the owner's pick, 2026-10-07). The scene's heading is its number ("Scene 4") over where and
  when it takes place ("Harrowgate hall, the morning after the fire"), from what the story keeps
  about the scene, with no title made up for it (the owner's pick, 2026-10-07). When Procreator
  ends a scene, its last words finish, then a quiet line says "End of Scene 4. It's going into
  the book.", with "On to Scene 5" under it. Until the owner goes on, the box waits and undo
  still works, so the move that ended the scene can be taken back (and the wrap-up waits for
  it); going on clears the page for the next scene's heading and opening (the owner's pick,
  2026-10-07).
- **A story opens from three openings** (the owner's pick, 2026-10-07). After Start, the play
  shows Scene 1's page with three short openings from Procreator (a line or two each) and the
  box set to "as the author". The owner picks one or writes their own, and Procreator writes
  that opening in full.
- **The play's top bar** (the owner's pick, 2026-10-07): an arrow back to the library on the left,
  then the book's title in place of the logo; on the right, undo, Story, Notes, Book (with its new
  scene mark) and the model chip. On a phone the buttons are icons and the title is cut short.
- **The story is a panel away mid story** (the owner's pick, 2026-10-07). A Story button in the
  play's top bar opens a panel beside the play on a laptop, or a sheet over it on a phone, as the
  Suggestions chat does. It holds the book's settings and the world at the top, then the cast as
  cards, then the relationship graph, all setup's own pieces, and a card or a line opens its sheet
  over the page. A book's card in the library opens its play, and setup's page is only for making a
  book. When someone joins the cast or a relationship shifts, a quiet line in the interface font
  marks it in the page where it happened ("Corwin joins the cast", "Mara and Ines: trust broken"),
  and tapping it opens that sheet (the owner's pick, 2026-10-07). The book never has them.
  The panel changes anything setup can (the owner's picks, 2026-10-11):
  - Someone added, removed, tied and untied, all as on setup's page. Removing someone or untying
    two asks "From now on" or "Always so", and Always so writes them out of everything already
    played.
  - The book's settings and the world sit at the panel's top as fields, and once one has changed,
    a Save shows at the panel's end, split into "From now on" and "Always so" as a sheet's is. A
    title change alone saves plainly, as a rename does.
  - Length saves plainly too, and the pacing follows it. Point of view or how dark it goes asks,
    and Always so rewrites what's been played (and later written) to match.
- **Procreator's notes have a panel of their own** (the owner's pick, 2026-10-07). A Notes
  button beside Story opens a panel the same way, with the reference's pages by kind (places,
  groups, things, lore, and the story's Plan, Threads and Timeline), each opening as a sheet
  over the page, and Procreator's memory, each note editable in place. A character's page is in
  their sheet, below the owner's. Plan and Threads say where the story is going, so opening one
  first asks "This is where Procreator means to take the story. Read it?" (the owner's pick,
  2026-10-07); once open, they read and edit like any page. Our calls (2026-10-15, the owner can
  change them):
  - A page's change asks "From now on" or "Always so", as a sheet's does, and so does taking a
    page out. Plan and Threads say where the story is going, not what happened, so they save
    plainly, from now on; so does Procreator's memory, which is about the work.
  - A page shows people in the cast as links, `[[Name]]`, as Procreator writes them, with a line
    under it saying so, so a rename still reaches them.
  - A character's page reads in their sheet with Edit beside it, which opens it as a page's
    sheet. The Notes panel doesn't list characters' pages.
  - New page is at the end of the pages, with its kind picked in its sheet. The story's own pages
    keep their titles, since Procreator looks for them by name.
  - A note of memory is a box where it is: Save and Discard show once it's changed, a bin forgets
    it (asked first), and an empty box at the end adds one.
- **Your turn is free text, with hints on tap.** One box where you write what you do and say in
  your own words. A tap shows 3 possible moves when you're stuck; otherwise nothing is suggested.
  They show as quiet lines just above the box, and tapping one puts it in the box to change
  before sending; nothing is sent until the owner sends it (the owner's pick, 2026-10-07).
- **You can play more than the main character.** A switch, "Main character and author only", is on
  by default: you play the protagonist and write author notes. Turned off, Procreator asks you each
  time another character is about to act whether you want to play them this time, and if you don't,
  their actor does (see "Every cast member has an actor"). The pinned box asks it ("Ines is about
  to act. Play her?", with "Play Ines" and "Her actor plays"), and playing them switches the box's
  chip to "as Ines" for that move, so the page stays prose (the owner's pick, 2026-10-07). The
  switch is in the box's bottom row, with Hints on its left and Send on the right, so nothing sits
  above the box but the hints when they're shown (the owner's pick, 2026-10-07).
- **Author notes come from a toggle on the box.** One tap switches it from "as <protagonist>" to
  "as the author" ("skip to the next morning", "make the storm worse"). The story follows the
  note without the character saying it, and the book never mentions it. The toggle is a chip at
  the box's top left; as the author, the box turns quieter, grey and italic (the owner's pick,
  2026-10-07). On the page a note shows while Procreator answers it, then folds away into a
  small mark between the paragraphs, which a tap opens again (the owner's pick, 2026-10-07).
- **Undo works until the scene is written.** While a scene is being played you can take back
  your last turns, or ask for a different reply to the same move. Once the scene is written into
  the book it's settled, so the book and the play never disagree. Only a change to the story's
  facts reaches back into it (see "Changing the past"), and that rewrites the play and the book
  together. An undo arrow in the play's top bar takes back one turn a tap and puts the owner's
  words back in the box, and "Another reply" sits under the newest reply (the owner's pick,
  2026-10-07), so the page itself stays prose.
- **A character starts as a few fields plus notes:** name, who they are, personality, past, and
  a free notes box. Only the name is required; the AI can fill any blank. How they relate to the
  others is in the relationship graph.
- **Characters grow as the story goes.** Whenever Procreator judges that a character has
  developed (a new fear, a secret revealed, a changed loyalty, a habit), it adds to their page in
  the reference by itself, below the owner's sheet, and those additions compound over the story.
  Characters who matter most end up with rich, complex pages; walk-ons stay small. The owner can
  open and edit any cast member's sheet or page at any time, and the edit reaches back through
  everything already played and written (see "Changing the past").
- **Every cast member has an actor.** Procreator directs and writes every word of the prose: it
  runs the world, the plot and the pacing. Each cast member but the protagonist (the owner plays
  them) is played by an actor of their own, who only answers what their character does, says and
  thinks right now. Procreator can send an actor back ("she wouldn't give in yet") without
  telling them the plot. So a character only knows what they lived, voices stay distinct,
  characters push back instead of indulging the player, and their history shapes who they
  become. How it works is in "Actors" below.
- **A change can reach back to the start.** When the owner changes something later, every
  earlier place that says otherwise can be brought in line: the state, the summaries, the turns
  and the written book.
  - **A rename always reaches back.** The new name is the name from the first page.
  - **Anything else asks: "Always so, or from now on?"** (a habit, a personality, a past, a
    relationship, the world). Always so rewrites the past to match. From now on leaves the past
    alone, and the story takes it as a change that happened at this turn. Once a sheet has
    changed, its Save becomes two buttons, "From now on" and "Always so", each with a short
    line under it saying what it does; a rename alone shows plain Save (the owner's pick,
    2026-10-07).
  - **A rewrite is kept at once, and listed after** (the owner's pick, 2026-10-11). An Always so
    or a rename lands straight away, and a quiet line in the play's page says how many passages
    it changed; a tap shows them, each before and after.

  How it works is in "Changing the past" below.
- **breading_ground keeps track of the whole book** (the owner's, 2026-10-06; the name is
  spelled so). A backend file, `breading_ground`, keeps track through code of the entire
  book's state: each scene, each chapter, each character, everything. A change made in any
  place is reported to it, and from there every part that needs to change is told, and makes
  its own change. It's the one door for changes (the owner's pick, 2026-10-07): nothing writes
  the story directly. Procreator's tools, the owner's edits and an approved list all ask
  breading_ground for a change; it writes it through the change log, which keeps it for undo,
  and then tells every part that depends on it. Built with play (step 6).
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
  first few things are filled in (so it has something to go on), every field still blank shows
  its suggestion as faint text where you'd type, all at once, made together from everything
  there so far (the owner's ask, 2026-10-07, in place of one field at a time). As the owner
  changes things, the suggestions are made again to fit. A field with text in it shows what
  could come next once it's clicked into. Tab or the right arrow key takes the faint text, and on
  a phone, which has neither, a tap on it does (the owner's pick, 2026-10-06); typing anything
  else clears it. It runs on the account's model, thinking as little as the model allows, so it
  lands before the owner starts typing (the owner's call, 2026-10-06).
- **Suggestions is a chat about the setup.** A Suggestions button opens a chat with Procreator:
  ask for anything, go back and forth, change your mind as often as you like. Once everything is
  agreed and you approve it, Procreator makes all the changes itself. On a laptop the chat is a
  panel beside the setup page, which stays in view, so approved changes land where the owner
  can watch them; on a phone it rises as a sheet over the page (the owner's pick, 2026-10-06).
  The chat is kept with the book: it's where the owner left it after a reload or another day.
  A new book's chat goes with its draft, so Clear and Start end it (the owner's pick,
  2026-10-07).
- **Approving is a list, and each item can be redone on its own** (the owner's design,
  2026-10-06). When the talk settles, Procreator lists every change it will make, with Approve
  under the list. Each item is exactly what it will write (a field and its new text, someone new
  and their sheet), so what's approved lands on the page word for word. Each item has its own
  "Writer's notes": write what should change about just
  that item, send it, and Procreator redoes only that item, in place. Nothing else on the screen
  changes, and the list doesn't move up or down. Saying something else in the chat makes a new
  list, which replaces the old one. Once approved, the changes land on the page in turn: each
  lands whole, about half a second after the one before, with a soft glow on its field, card or
  line, and the page scrolls to follow (the owner's pick, 2026-10-07, "Glow in turn"). They're
  as if the owner typed them, so a book's wait for Save.
  Approve goes through the server, which answers with the changes to land: the list's items
  that still fit the page as it stands. That's where breading_ground comes in, once it's built
  (the owner's pick, 2026-10-07: the seam now, breading_ground with play).
  In the chat, the owner's words sit in a soft grey bubble on the right, and Procreator's run
  plainly across the panel, lists included (the owner's pick, 2026-10-06). The Suggestions
  button sits at the right of the page's heading ("New book", or the book's title), on the
  same line, and stays pinned in view as the page scrolls without ever covering anything on it
  (the owner's pick, 2026-10-06, in place of the top bar).

### Open (ask the owner one at a time, in roughly this order)

1. Design direction for each new screen, asked when we reach it. Setup's suggestions and play
   have theirs (see "Decided"). The library and the book view start as copies of breader's
   pages; where the owner writes, the writer goes past breader (see "Writing gets a feel of its
   own").
2. Bringing your own AI (step 9): how a writer's own key or sign-in is kept and used
   (CLIProxyAPI pools the accounts signed in to it, so one writer's sign-in could end up
   serving another's calls), and what counts as the free chapter (chapters come with the book,
   step 7). A risk to keep in view: subscription sign-ins like Antigravity are generally for
   their holder's own use, so serving every writer's first chapter through the owner's could
   get it limited.

### Build order

Each step ends working, committed, and with a short test checklist for the owner, who works
through them all in one local test once everything is built (see "Status").

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
4. **Settings.** In the model picker, where the owner signs CLIProxyAPI's accounts in and out
   (Antigravity first), through its management API, and sees which are signed in. Only the
   owner sees them.
5. **Setup help.** Procreator's suggestion in whichever setup field is clicked into (faint text,
   taken with Tab or the right arrow key), and the Suggestions chat, which makes the agreed
   changes itself once the owner approves them.
6. **Play.** Procreator narrating, the cast's actors, and the play tools: turns, the author
   toggle, playing other characters (the "Main character and author only" toggle), hints on
   tap, undo within a scene, scenes ending (and their wrap-up), the cast growing and new
   characters joining, relationships shifting, and the owner's changes reaching back through
   the turns and the state.
7. **The book.** The scene writer, the book view (a copy of breader's reader), the progress bar
   and the EPUB download, and the owner's changes reaching back into written scenes.
8. **Ship.** The ThinkPad's compose services, a Cloudflare route from `breader.site/writer` to
   the writer's app, the writer API behind the tunnel, and the nightly backup. The writer API
   must reach a CLIProxyAPI on the ThinkPad, management routes included, which only answer their
   own machine unless told otherwise (`allow-remote`): breader's worker runs one with
   `allow-remote` on, and the writer joins its network (see "Notes for step 8").
9. **Open to everyone.** A writer's own AI in settings (a key, or a subscription sign-in), and
   everyone's first chapter free on the owner's account. It follows the book, since the free
   chapter needs chapters.

### Notes for step 1

- Books belong to a breader **account** (its Better Auth user id), since only allowlisted
  accounts can play. A key session alone can open the writer and see the invite note.
- Logging in happens through breader's own API (`/v1/auth/*`), with breader's login dialog. The
  writer server only reads the session, against breader's database.
- The writer has no Key button: a key can't play, so the writer is accounts only.
- It's one login with breader, so logging out of the writer logs out of breader too (the menu
  says so). It doesn't touch breader's library in the browser.

### Notes for step 2

- A book's setup page (`books/<id>/setup`) is for looking over and changing what it was set up
  with. Nothing changes until Save, and leaving with changes asks first. Since the play page, no
  card opens it, and once anything is played its Save is turned away (`story_started`): mid story,
  the Story panel changes a book, through breading_ground.
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
  production whatever serves `/writer` must answer every path under it with `index.html` (step 8).

### Notes for step 3

- The setup page still saves a book's sheets directly, not through the change log. Once a book
  is being played (step 6), the owner's edits go through the log, asking "always so, or from
  now on?".
- A relationship's history goes into the brief whole for the people in the scene.
- Folds run on the account's own model and thinking level, as play does.
- Play (step 6) sends the owner's moves through `converse`, wraps an ended scene up as the next
  one's session opens, and undoes turns through breading_ground (`takeBackTurn`: `takeBack` of
  the turn's changes and `cutSession`). breading_ground tells Procreator of the owner's mid
  scene changes with a note at the end of the session (see "Notes for step 6"). How each turn is written in the session is in "Notes for step 6".
- A session's instructions and tools must be the same for every call in it, folds included, or
  the provider's cache misses. Play's tools join the memory tools for every run, not only for
  play's own.
- "Always so" edits and renames (steps 6 and 7) start the session again from the rewritten
  turns: a new segment with a fresh head, the turns rebuilt as plain messages (their tool calls
  and thinking don't survive a rewrite). Built with step 6's edits, the actors' chats too (see
  "Notes for step 6").
- First run against the real model (2026-10-06): Gemini 3.8 Flash through the owner's
  Antigravity, two moves and the wrap-up, in a scratch database (never the owner's). It worked
  end to end. The first move set up Plan, Threads and Timeline before narrating; the wrap-up
  wrote both people's pages, a place, a group and some lore, shifted their relationship, and
  summed the scene up well, keeping what each hides. To watch:
  - The wrap-up saved one thing per call (13 calls for two moves), though Gemini can make
    several calls at once. Fine for quality, slow on a long scene.
  - Cache reads came back 0 on every call, even past Gemini's 4,096 token minimum. It isn't the
    proxy or the writer (see the caching note below): Antigravity's backend reported none.
  - Without `CLIPROXY_MANAGEMENT_KEY` the catalog knows no thinking levels and takes the window
    as 128k, so compaction would start at 96k instead of 400k. The key comes from the owner.
  - Its prose uses em dashes, which the story may not (see "Writing").
- Caching, checked against CLIProxyAPI 8.0.5's source (2026-10-06). Every exchange asks for the
  long cache (`cacheRetention: 'long'`) under the scene's id (`sessionId`), since the owner
  often takes longer than five minutes over a move:
  - Claude: pi marks the instructions, the last tool and the newest message to stay cached for
    an hour. With a Claude sign-in, the proxy places the marks itself, the way Claude Code does,
    and makes them an hour too, within Claude's limit of four.
  - Codex: the cache is keyed by the scene (`prompt_cache_key`), which the proxy also sends as
    the session. The proxy drops the 24 hour retention on the way, so Codex keeps the cache as
    long as it keeps it.
  - Gemini (Antigravity): nothing to ask; a prefix it has seen is cached by itself. The proxy
    passes its usage on whole, cached tokens included, and keys the session by the first
    message (the head), which stays the same through a segment. Antigravity caches, but
    seldom: of 48 calls in the 2026-10-15 run, past 4,096 tokens and often seconds apart, only
    two read from the cache (14,102 and 14,645 tokens, two of the wrap-up's). Its input count
    leaves the cached tokens out. Keep the start steady, so it can.

### Notes for step 4

- The proxy here is CLIProxyAPI 8.0.5 (Homebrew, port 8317). The writer uses its v8 management
  API, under `/v8/management`. Sources: `github.com/router-for-me/CLIProxyAPI`,
  `docs/management-api-v8.md` and `internal/api/handlers/management/`.
  - `GET /credentials` lists the accounts (`files`, each with `name`, `provider`, `email`,
    `label`, `status`, `status_message`, `disabled` and `unavailable`), and
    `DELETE /credentials?name=<file>` signs one out.
  - `GET /oauth/auth-url?provider=antigravity|codex|claude&is_webui=true` starts a sign-in
    (`url`, `state`), and `GET /oauth/status?state=` answers `wait`, `ok`, or `error` with a
    reason. `POST /oauth/callback` (`state`, `redirect_url`, no key needed) hands the proxy the
    address the sign-in ended on, and `DELETE /oauth/session?state=` stops waiting.
- `is_webui=true` has the proxy listen for the provider's callback on its own machine
  (Antigravity on 51121, Codex 1455, Claude 54545), and it waits 5 minutes. With the browser on
  that machine too, the sign-in finishes by itself. Anywhere else (production) the last page
  can't load, so the owner pastes its address into the box under the sign-in.
- Five wrong management keys in a row ban the caller's address for 30 minutes, local callers
  included (a ban answers 403, a wrong key 401). The catalog spends one try per kind of account
  each time it reads the models (once a minute at most, and at once after a sign-in or out), so
  a wrong key gets there within minutes. Only the owner has the key.
- Signing in opens the provider's page in a new tab, opened in the click handler (so the browser
  allows it) with no opener, then sent to the page once the server answers. The picker asks
  after the sign-in every 2 seconds; that lives in the picker, not its menu, so it goes on while
  the menu is closed.
- The login dialog's fields showed Dongle at 22px instead of the interface font, from step 1 on.
  Breader's App imports its Add a book dialog (and `add.css`) before the account menu; the writer
  dropped that dialog, so the account menu's `account.css` loads first, and add.css's field
  (`.add-input`) came later and beat `.login-input`, which is just as specific. account.css now
  doubles the class (`.add-input.login-input`), so it wins whichever loads first. A rule copied
  from breader that overrides another file's may need the same.

### Notes for step 5

- A suggestion runs on the account's own model, thinking as little as the model allows
  (`quick` in `server/src/suggestions/quick.ts`), whatever level the account picked. Gemini 3 is
  asked for low, and marked as a model that thinks even when the catalog can't tell (no
  management key), or pi would ask for no level and it would think at its default, high.
  Through the proxy, "minimal" is turned away (a 400), and no thinking at all (a budget of 0)
  doesn't always hold. Any other model gets the lowest level the catalog knows it takes. Nothing
  shows while it's on its way, and nothing shows when Procreator can't help (offline, or no
  answer): the field is just a field.
- Nothing is suggested until 3 things on the page are filled in (`SUGGEST_AFTER`, a default the
  owner hasn't picked).
- The blank fields (`frontend/src/features/setup/useBlanks.ts`): every text field with nothing
  in it, on the page and in every sheet, is asked about in one call, 1.5 seconds after the page
  is left alone, so the suggestions fit each other. A sheet opens with its blanks shown already.
  When the owner changes something themselves (types, adds someone, ties two), they're asked
  for again, and the ones shown stay until the new ones land. Taking one isn't such a change
  (the rest were made to go with it), so it asks nothing. One call is out at a time; a change
  while it's out asks again once it's back. When Procreator can't help, what's shown stays, and
  it isn't asked again until the owner changes something. Escape hides a field's faint text
  until the next ones come. A click or a tap on a field nobody is writing in only puts the caret
  there.
- A field with text in it is asked about on its own, 0.4 seconds after it's clicked into, so
  tabbing past it asks nothing. Typing or leaving the field clears that faint text, and the page
  stops waiting for it. Moving the caret off the end only hides it, and switching windows keeps
  it. Escape clears it without closing the sheet it's on.
- Taking faint text types it in (`execCommand('insertText')`), so undo takes it back out. A
  mouse click on the faint text doesn't take it (Tab and the arrow are right there, and a click
  near a paragraph's end shouldn't take one by accident); a tap in the field being written in
  does.
- The instructions are the same for every call of a kind, then the page as it stands, the field
  (or the numbered blanks) last. The blanks' answer fills each by its number,
  `<fill n="3">...</fill>`. The cache is asked to last long, keyed by the book, or by the account
  while the book isn't made. Each call is recorded as `setup`.
- When the page stops waiting, the server stops the model call (the request's signal). Locally
  Vite's proxy doesn't pass that on, so there the call runs to the end.
- A half-width line field (genre, tone) cuts a long suggestion off at its right edge. A paragraph
  field grows to fit its faint text, as far as it may grow; past that, later lines are cut off.
- A sheet's first field (a character's name, a line's bond) asks for the focus. The dialog
  (`components/Modal.tsx`, from step 1) used to take it just after, so the field never kept it;
  since 2026-10-15 the dialog takes the focus only when nothing in it has.
- Tried against the real model (2026-10-06): Gemini 3.8 Flash through the owner's Antigravity,
  at the model's own thinking (no management key yet), through the server's own code with no
  login, since the desktop app's browser can't load `local.breader.site`. Twelve fields of a
  sample page, recorded in a scratch database. To watch:
  - The suggestions were good: they fit the page and its spelling, kept to their field (a name,
    a few words of tone, a bond), went on from a half-written field without repeating it, and
    what someone hides fit what the page said they owe.
  - Each took 7 to 16 seconds, nearly all of it thinking: 400 to 1,400 tokens out for 10 to 60
    words shown. About 960 tokens go in, under Gemini's 4,096 token minimum, so nothing is
    cached.
  - One answer used an em dash, which setup help may not (see "Writing").
  - Giving up stopped the call within half a second.
  - Thinking low, the same twelve fields again: most took 3 to 6 seconds, as good as before. The
    most open ones (a blank title, a blank personality, a name) still thought for 500 to 800
    tokens and took 7 to 12. No thinking at all was about as quick, but one call in four thought
    for 9 seconds anyway.
- The blank fields all at once, tried against the real model (2026-10-15), thinking low: a half
  filled page (a gothic mystery in a Cornish hotel in 1952, a night clerk and the hotel's owner,
  a third person with nothing filled in, and a line between the first two with nothing on it),
  asked twice. Each time all 20 blanks came back from one call in 13 to 14 seconds (2,024 tokens
  in, about 1,000 out). They fit each other and the page: the nameless one got a name and a past
  that ties into the others', what each side hides fit what the other sees, and the title fit
  the setting. The two rounds differed throughout. No dashes.
- The Suggestions chat (`server/src/suggestions/chat.ts`) is one session, kept as the scene
  sessions are: every message as the model was sent it, in order, only ever added to
  (`setup_chat_messages`), so each call starts as the one before and the cache can hold it.
  What the chat shows is kept apart (`setup_chat_entries`): the owner's words, Procreator's, and
  its list with how it stands (open, approved or set aside). The page goes into the owner's
  message only when it has changed since Procreator last saw it (the chat keeps it as text). It
  runs on the account's own model and thinking level, not the quick one: this is the owner's story
  being shaped. One exchange at a time in a chat (held in memory, so one server).
- A list is `propose_changes`: a note for the owner and the changes, people by name. Each item
  is checked against the page in order, as it would land, finding people by the names Procreator
  saw first and then by the names the list gave them (naming someone renumbers the nameless after
  them). What doesn't fit goes back to Procreator item by item, with nothing shown, as often as
  it takes. A list that fits ends the exchange, so it costs no extra call, and its note is shown
  (and streamed) as Procreator's words: Gemini wrote no words beside its lists otherwise.
- Saying anything else sets the open list aside. Approving marks it approved, and the owner's
  next words tell Procreator so. Approving sends the page as it stands and answers with the chat
  and the changes for the page to land: the list's items that still fit it, in order
  (`stillFitting`), since the owner may have changed the page after the list was made. A redo
  restates the item as Procreator writes a change, with the owner's notes, and `revise_change`
  has to change the same thing (the same field, choice, person or line); someone added keeps
  their id, since the items after know them by it. The list changes in place and nothing is said
  in the chat.
- `POST /v1/suggestions/chats` streams server-sent events: `started` (the chat's id), `text`
  (Procreator's words as they come), then `done` (the chat), or `error` (why, with the chat as
  kept: the owner's words stay even when the model doesn't answer).
- Procreator lists a change as soon as one is asked for, with its best version, instead of asking
  first whether to: the list is where the owner agrees, and any item can be redone. It asks first
  only when it can't tell what the owner wants. (Our call, 2026-10-07, after it asked "shall I?"
  in the real run; the owner can change it.)
- Tried against the real model (2026-10-07): Gemini 3.8 Flash through the owner's Antigravity, at
  the model's own thinking (no management key), in a scratch database. Four exchanges: a list of
  two, a new list when the owner asked for one item to change, a redo, and a name and a line for
  someone. Each was one call, 6 to 9 seconds, except the last (36 seconds, nearly all thinking).
  The lists fit the page and kept what each person hides. A tool result followed by the owner's
  next words (two user turns in a row) goes through fine. Under 4,096 tokens in, so nothing
  cached yet.
- The chat's panel (`SuggestionsChat.tsx`) was built 2026-10-07 in a session with no browser, and
  checked in headless Chrome against a stand-in API on 2026-10-15: the words streaming in, a
  list, an item redone in place, approving, the changes landing in turn, and the sheet on a
  phone. At 1100px and wider
  it's a panel fixed on the right, 420px, and the page makes room for it
  (`.setup-page:has(.chat-panel)`); it isn't modal, so the page goes on working beside it.
  Narrower, it's a sheet rising over the page, a dialog that Escape closes once it's the last
  one open. `SetupForm` holds the chat (`useChat`), so closing the panel doesn't stop an answer.
  The log keeps to its end as words come in, but not on a redo or an approval, so a list never
  moves. Enter sends, and Shift and Enter starts a new line; words the server never took go back
  in the box. Errors show under the log, in view whatever failed.
- The Suggestions button has a column of its own beside the page's (`.setup-rail`), and sticks
  at the heading's height from the start, so it stays in view and never moves or covers
  anything. A phone shows only its icon, in a column 40px wide.
- Landing (`landing.ts`): `SetupForm` makes each change in turn on the page as the one before
  left it (`applyChange` on a ref of the setup, since a new book's page takes a whole setup),
  lights where it went for 1.4 seconds, scrolls there, and waits 650ms before the next. The
  places are marked with `data-land` and a key (`spotsOf`): a field, a choice, someone's card,
  the cast, the graph and each of its lines. A change to a sheet's field lights the card or line
  it belongs to, and the field too if its sheet is open. The glow is a ring drawn over the place
  (an `::after`, or a heavier stroke over a line), so the place's own look is left alone. On a
  phone the sheet closes first. An approved point of view counts as the owner's own pick, so
  picking Light novel afterwards doesn't change it.
- A new book's chat id is kept in its draft (`chatId`), so a chat started on a blank page keeps
  the draft, and Clear ends the chat too.

### Notes for step 6

- breading_ground (`server/src/breading_ground.ts`) is the one door for changes to the story:
  every write of the story's modules (`story/`) is called from it alone, which
  `test/door.test.ts` checks by reading every file's imports. It writes through the change log,
  and then tells what depends on the change: so far, a turn taken back cuts the scene's session
  back to before it. Whatever Procreator writes comes through it without dashes.
- The first scene is made when the owner first opens the play, waiting (`next`) with everyone in
  it, and its session opens there and then to ask for three openings (an aside, never sent
  again). The opening's call starts the same way, so the cache holds the brief. A pick sets
  where and when the scene opens and who is in it; with the owner's own opening, Procreator sets
  them (`set_scene`). The openings stay with the scene, so taking the opening back shows them
  again.
- A turn is a move (`character`, with who the owner played in `played`), an author note, a
  scene's opening (`opening`: the first scene's has the owner's pick in it, a later one's is
  empty), or an actor's (`actor`: who they played in `played`, their answer as its input). Each
  is sent as `procreator/turn.njk` lays it out.
- The narration is everything Procreator writes in the run, reply after reply, streamed as it
  comes and kept as the turn's reply. Its instructions ask it to narrate first and save after,
  so the words start sooner, and for 150 to 400 words a turn in the past tense (our calls,
  2026-10-07; the owner can change them). A turn it can't narrate (no answer, or no words) is
  taken back whole, as if it was never made, and the stream says why.
- Ending a scene (`end_scene`) makes the next one at once, waiting as `next` with where and when
  it opens and who is in it, so undoing the move that ended it takes it away again. Going on
  begins it; its session opens with the scene before wrapped up first, then Procreator opens it.
  A later scene's opening can't be taken back, only written again ("Another reply"). If the
  wrap-up or the opening fails, the scene stays begun with no turns, and going on again opens it.
- Undo takes back what Procreator changed at the newest turn, and leaves what the owner changed.
  "Another reply" is an undo and the same move sent again: the session goes as if the first
  reply never happened.
- Hints are an aside in the scene's session, on the protagonist: `offer_moves` with three moves,
  and the memory tools turn writes away meanwhile. The openings are asked the same way.
- The quiet lines after a turn are read from the change log: the characters and the
  relationship history Procreator made at the turn, while they stand.
- The play tools (`set_scene`, `join_cast`, `end_scene`, `offer_openings`, `offer_moves`) are in
  every call beside the memory tools, the same each time, and each turns a call down outside its
  time. Someone who joins the cast gets a sheet Procreator writes (the owner can change it) and
  is in the scene; the cast holds 40 besides the protagonist, as setup's does.
- One exchange at a time in a book (held in memory, so one server), as in the Suggestions chat.
- The actors (`procreator/actor.ts`, their chats kept by `story/actors.ts`; see "Actors"). Before
  anyone in the cast acts or speaks, Procreator cues their actor (`cue`) with what they see, hear
  and know now, and writes their part from the answer, which comes back as the tool's result; it
  can send an answer from the same turn back with a note on the character (`send_back`). The
  protagonist and passing extras have no actor, and cueing someone brings them into the scene.
- An actor's chat opens at their first cue, at that turn: the story's title, darkness and world,
  then who they are (`actor/self.njk`: the owner's sheet, Procreator's page about them, and their
  own side of each relationship). Never the Plan, the Threads, anyone else's page, or what's
  hidden from them, so Procreator's instructions say to keep what's hidden from someone off their
  page. At every cue, who they are now is checked against what they were last told, and the cue
  starts with it when it differs (`<you_now>`); the scene goes in when it's new to them. Each
  call sends the chat as it stands and one message more, asks for the long cache under the
  actor's own key, and keeps the two only once the actor has answered, so a failed call leaves
  the chat as it was. Calls are recorded as `actor`.
- The switch "Main character and author only" is each ask's `playOthers` (false, the switch on,
  unless said), on every ask that has Procreator write. With it off, a cue stops the turn there
  (`finishTurn`): the turn keeps the cue (`turns.cue`), the play's stage is `cue`, and `Play.cue`
  is the one about to act. The next turn answers it, and nothing else can be sent meanwhile:
  either the owner's move as them (`as`, their id), which their actor is told as their own
  (`<played>`, with nothing asked), or `.../play/actor`, a turn of the actor's own, which
  Procreator then writes from. Hints are for the one about to act. Undoing an actor's turn gives
  no words back for the box, and "Another reply" to it has the actor play the moment afresh.
- Undo cuts the actors' chats back with the turn (`cutActors`), segments made at it included, so
  a chat that opened at the turn opens afresh at the next cue.
- An actor's compaction is past `compactAt`, as a session's. The scenes that fold are written
  into what they remember, in their own voice (`actor/fold.njk`), and a new segment opens with
  who they are now and that memory; the newest scenes that fit in a fifth of the limit stay word
  for word. Only scenes that are wrapped up fold (the wrap-up saved what they established to the
  reference, their page included), so the scene being played never does. A fold that fails
  leaves the chat as it was.
- The play page (`frontend/src/features/play/`) is a book's own address, `/writer/books/<id>`.
  A card opens it, and so does Start. A first scene with no openings asks for them as the page
  opens (once; after a failure the owner asks again). Our calls where the owner's picks didn't
  say (the owner can change them):
  - One tap on an opening opens the story with it, since undo brings the openings back.
  - After a note as the author is sent, the box goes back to the owner's character.
  - Sheets hold no pronouns, so the cue's ask is "Ines is about to act.", with "Ines's actor
    plays" and "Play Ines". Tapping the "as Ines" chip asks again.
  - A move as someone other than the protagonist shows "as Ines" before it on the page.
  - The first scene's opening shows as a folded "Opening" mark, as an author's note does; a later
    scene's opening has no words of the owner's, so nothing.
  - The switch is kept in this browser for each book (`writer.playOthers.v1`), on unless the
    owner turned it off.
  - Undo puts a note back as the author, an opening of the owner's own back in the box, and a
    picked opening nowhere (it's offered again). An actor's turn gives nothing back.
  - Leaving the page stops what Procreator is writing, which takes the move back, as closing the
    Suggestions chat's page does.
  - Story is in the top bar after undo, then Notes and Book.
- The Story panel (`frontend/src/features/story/`), as the owner's picks have it (see "The story
  is a panel away mid story"). Our calls where they didn't say (the owner can change them):
  - Before anything is played, everything saves plainly, and removing or untying doesn't ask:
    there's no past.
  - Tying two who aren't tied is a change like any line's: their sheet opens blank, says
    "Saving ties them", and asks how far back it reaches. Closing it leaves them untied.
  - "From now on" is the dark button and "Always so" the quiet one, the same in a sheet, the
    panel's end and the ask before removing or untying.
  - Closing a sheet with changes that weren't saved asks first, as leaving setup does. The
    panel's end has Discard beside its Save.
  - Procreator's page about someone shows below their sheet, to read; editing it is the Notes
    panel's. Fields mid story have no faint text: setup help is setup's.
  - A change on its way holds the play: the box, undo and hints wait, and the line above the box
    says how far a rewrite has got ("Procreator is rewriting what was played, part 2 of 3").
    Closing the panel or the sheet doesn't stop it; leaving the page does, and nothing is kept.
  - The story is read again whenever the panel or a sheet opens and whenever the play changes.
  - The quiet lines in the page are buttons: someone joining opens their sheet, a relationship
    shifting opens the line's, and a rewrite ("Renamed Ren Renji: 3 passages rewritten") opens
    each passage where it is, before (grey) and after.
- The owner's edits mid story (`ownerEdit` in breading_ground, `POST /v1/books/:id/story/edits`):
  someone's sheet, someone new (`join`), someone leaving (`leave`), a line tied or changed, two
  untied, or the book's choices and world together (`book`), each with how far it reaches
  (`now` or `always`). Each is one change, the owner's, tagged at the newest turn with why
  ("from now on" or "always so"), so undo leaves it. A change that changes nothing makes no
  change and tells nothing.
  - From now on, Procreator is told with a note at the end of the session of the scene ahead (the
    one being played, or the one waiting): what changed, each field as it was and as it is now
    (`story/edits.ts`, `procreator/change.njk`). It's added at no turn, so an undo never cuts it,
    and its instructions say to play it as something that just happened and save it to the
    reference.
  - Someone who leaves from now on keeps their sheet with the role `left` (`LEFT` in
    `story/cast.ts`), so everything written still names them and no one else can take their
    name. They're out of the scene they were in and the cast as Procreator, the actors and the
    panel see it (`standingOf`, `standingByName`); their lines and history stay, shown only
    between people still standing, and the brief marks them as gone. Untied from now on, a
    line's history stays as what happened between them.
  - Before anything is played there's no past: someone leaving is taken out whole (their page,
    lines and history too), an untied line takes its history, a rename is just a name, and the
    first scene's session, if the openings opened it, starts again from a fresh brief instead of
    a note. An opening offered before someone was taken out brings in only who still stands (our
    call, 2026-10-11).
  - Once anything is played, a rename and "Always so" reach back (`play/edits.ts`, then
    `ownerEdit`). The book's title and length never do, and nor does someone joining. Before
    anything changes, Procreator rewrites the story's passages (`story/passages.ts`): each
    scene's turns, where and when it is and its summary, then the reference, memory, the
    relationships' history and the owner's own sheets, lines and world, and the working copies
    that will be sent again (the owner's notes in a session that goes on, and the actors' chats
    and what they remember). It's given a part at a time, each passage numbered with where it is
    (`procreator/rewrite.ts`), with people named as they'll be once the change is made, and edits
    with exact words found once, or every place they stand as whole words, or the whole passage
    (`rewrite_passages`). Edits that don't fit (words not there, a passage emptied that can't be,
    a link to no one) go back to it with nothing kept, as often as it takes. What the change
    makes or takes out itself (the sheet, the line, the world, someone written out) isn't given
    to it.
  - A rename alone gives Procreator only the passages with a word that starts like one of the old
    name's words, in any case (`mayName`), and the rest of a renamed sheet holds from now on, told
    as a note. Always so tells Procreator the whole change, and nothing after: the story always
    said so. Someone taken out always so is written out of everything played ("was never in the
    story") and removed whole, and a new point of view always so has every narration rewritten
    whole in it.
  - Nothing is kept until every part is rewritten. Then, in one transaction, the owner's change is
    made, and the story's passages are kept as another change of the owner's (why "rewrote the
    past", `REWROTE`), so each keeps the version it replaced. Every scene session that goes on
    (the one being played, or one ended and waiting for its wrap-up) starts a new segment at no
    turn, with a fresh head and its turns as plain messages, the owner's notes where they were;
    every standing actor's chat a new segment with who they are now, what they remember and its
    messages as they read now (`procreator/rebuild.ts`). The messages keep their turns, so an
    undo still cuts them, and the new segments stay (migration 0011 lets an actor's segment be
    made at no turn).
  - The edit is streamed: how many parts are done, then the story and what was rewritten. Reaching
    back while the AI is offline is a 503 before anything starts. The quiet line in the play's
    page is a `rewrote` mark on the turn the change was made at, with how many passages it
    rewrote, and `GET .../story/rewrites/:change` lists them, each before and after. The count is
    the story's own passages; the working copies aren't the story.
  - An undo after a rename leaves it and its rewrite, and gives the owner's words back as they now
    read. Undoing a turn whose changes a rewrite built on is turned away, as the change log turns
    such undos away, in words the owner can read.
  - The openings kept with the first scene, a cue kept with a turn (`turns.cue`) and pages'
    titles are passages too (2026-10-15): the openings come last in the first scene's part, and
    are kept together, as one version of the scene; a title can't take a person's name or another
    page's. Still not rewritten: a turn played as someone written out always so still says who
    played it ("someone no longer in the cast").
- The Notes panel (`frontend/src/features/story/NotesPanel.tsx`), on the same story as the Story
  panel (`useStory`), and the owner's changes to pages and memory through the same route and
  `ownerEdit` (`page`, `unpage`, `note`, `forget` in `StoryEdit`; `story/notes.ts`). From now on,
  Procreator is told with a note as for any change; a change to its memory says it's about the
  work. A page always so is rewritten into what was played like a sheet, and the page itself is
  left out of the passages (`Untouched.pages`). Plan and Threads never reach back, even asked
  always so. Owner's titles are checked as Procreator's are, and can't take a cast member's name
  or another page's.
  - Rewrite calls are recorded as `rewrite`, keyed for the cache by the book
    (`rewrite-<book id>`), so every part starts the same.
  - The owner's local database was at migration 0011 from 2026-10-13 (backed up just before as
    `.backups/2026-10-13-before-0008.sql`). Their book came through whole: 10 characters, 16
    relationships, nothing played yet.

- Tried against the real model (2026-10-15): Gemini 3.8 Flash through the owner's Antigravity, at
  the model's own thinking (no management key), in a scratch database (never the owner's). A
  short story with three people: the openings, the first one opened, two moves, an author note
  ending the scene, going on, the chapter, a rename and one more move. It worked end to end.
  - The openings took 13 seconds, and opening with the first 69. A move took about a minute:
    Procreator cues each actor in the scene before writing their part, narrates, then saves one
    thing per call, six or seven calls in a row, each sending the whole session again, while the
    box waits. Asking it to make its saves together in one reply cut a move to three calls, but
    that move saved nothing, and the account's limit came before a second try, so the
    instructions are as they were. Worth trying again, carefully: the saving matters more.
  - The prose was good: close third, past tense, within the words asked, no dashes, straight
    quotes. The actors kept to their sides (the evasive one evaded, the anxious one panicked),
    and when the protagonist said what she had seen, the relationship shifted and its quiet line
    showed.
  - The author note ended the scene where asked (`end_scene`, the next one waiting where and when
    the note said) and closed it in a paragraph. Going on wrapped the scene up in four calls and
    opened the next, 54 seconds in all.
  - The rename took 113 seconds, four calls for three parts, and rewrote 10 passages: the turns,
    the summary and the chapter, possessives included, with the old name left nowhere.
  - The next call met the account's limit for the model (a 429, "Individual quota reached",
    resetting in 90 hours). The move was taken back whole, as a turn that fails is, and the
    routes now say so in words instead of "Try again in a moment" (`failedFrom`).

### Notes for step 7

All of step 7's design calls are ours (2026-10-15, the owner can change them), made after the
owner said to finish everything without asking.

- **A chapter is a scene.** Once a scene is wrapped up (the owner went on from it, so it can't be
  taken back), the scribe (`server/src/book/scribe.ts`) has Procreator write it into the book as a
  chapter, in the background: the book trails the play and the play never waits for it. Chapters
  are written in order, the lowest scene first, each with the one before in view, and a chapter
  has its scene's number. One book at a time per server, as play is. The scribe is nudged after
  every play exchange, and whenever the play or the book is opened, so a chapter that failed (no
  answer, cut off, nothing written, or the AI offline) is tried again then; nothing writes it
  meanwhile. Tests run without it (`Deps.scribe` is null) and write chapters through
  `writeMissing`.
- **The author's call** (`procreator/author.ts`) is one call on the account's own model and
  thinking level, recorded as `author` and keyed for the cache by the book (`author-<book id>`):
  its instructions (`author/system.njk`: the book's settings, how a chapter is made from the play,
  the title, the format), then the ask (`author/ask.njk`): the brief's world, story so far,
  Procreator's notes, cast, relationships and the scene's places, the chapter before whole, the
  scene's turns word for word, and the task last. It's asked for about 2,000 words, more or fewer
  as the scene holds, and for `<title>` and `<chapter>` tags; an answer without a chapter tag
  gives its first line as the title (unless it had one) and the rest as the chapter. A conventional book's
  chapters get short titles, a light novel's long descriptive ones. Written to Google's Gemini
  3.8 Flash guides (fetched 2026-10-15): no sampling settings, context first and the task last,
  the length asked for, tags used the same way throughout.
- Tried against the real model (2026-10-15, see the run in "Notes for step 6"): a scene of five
  turns became "The First Wick", 1,704 words in 39 seconds (3,076 tokens in, 3,971 out with its
  thinking). It kept the play's dialogue word for word or close to it and filled the scene in
  around it (the place, the weather, the gestures, the world's history from the brief), in close
  third and the past tense, with no dashes. A short scene gives a chapter short of the 2,000
  words asked, as the ask allows.
- **A chapter is the story's** (`chapters` table, `story/chapters.ts`, through breading_ground's
  `writeChapter`), so its title and prose are passages: a rename or an always so rewrites them with
  the turns, and a new point of view rewrites them whole. A chapter read before such a rewrite
  landed isn't kept (`writeChapter` answers null when a rewrite came after the scribe started),
  and the scribe writes it again from the story as it now reads. The book's words written are
  its chapters' words, counted again whenever a chapter is kept or rewritten (the card's bar
  fills with them); the recount after a rewrite is a change of its own ("Counted the book's words
  again"), so a rewrite lists only passages. Procreator's `search` reaches the book too.
- **A story ends** when Procreator calls `end_story` (its instructions say to, once the story
  reaches its ending, as the brief says where it stands against its length, or when the owner
  asks). The scene being played ends with no next one, and the play's stage is `ended` with no
  `next`: "The end", with "Finish the book" under it. Until then, undo and another reply still
  work, so the ending can be taken back like any scene's. Finishing (`POST .../play/finish`)
  wraps the last scene up, which puts it in line for the book, and the stage is `finished`: the
  box takes nothing, there's no undo, and "Read the book" under "The end".
- **The book view** (`frontend/src/features/book/`, `/writer/books/<id>/book`) is breader's reader
  copied and cut down to a book of text: pages or scrolling, the contents, Appearance (theme,
  typeface, size, spacing, margins, layout, justify), full screen, the progress dots and minutes
  left, keys and swipes, with no voices, Immersive, comments, search, AI or pictures. Its settings
  are its own (`writer.reader.v1`), apart from breader's. Each chapter is a section: "Chapter 4"
  small over its title, then its paragraphs. A line after the last chapter says what's still to
  come ("Chapter 5 is being written.", "The end."), and the contents end with it and "Download as
  EPUB". While a chapter is being written the page asks again every 5 seconds, and every minute
  while one waits that isn't (each ask nudges the scribe). The place is kept in this browser
  (`writer.place.v1`). Back (or Escape) goes to the play.
- **The play's Book button** has a dot while the book has more chapters than the owner has seen in
  the book view in this browser (`writer.bookSeen.v1`, against the play's `chapters`). On a
  narrow phone the tools close up and the model chip keeps to a short name, so the title keeps
  some room, cut short.
- **The EPUB** (`server/src/book/epub.ts`, a store-only zip of our own in `book/zip.ts`) is EPUB 3:
  the mimetype first, a title page, a contents page (`nav.xhtml`, which breader reads its chapters
  from), and a page a chapter (`<section epub:type="chapter">` with "Chapter 4" as its `h1` and its
  title as its `h2`), with no styling of its own. Its author is the owner's name on breader, and
  its file name the book's title.
- The owner's local database is at migration 0012 (the chapters) since 2026-10-15, backed up just
  before as `.backups/2026-10-15-before-0012.sql` and tried on a copy first. Their book came
  through whole. Then 0013 (a writer's own AI, step 9), the same day, backed up as
  `.backups/2026-10-15-before-0013.sql` and tried on a copy: 1 book, 10 characters and 16
  relationships came through.

### Notes for step 8

All of step 8's design calls are ours (2026-10-15, the owner can change them). How to set it up,
check it, back it up and restore it is in `infra/README.md`; nothing is deployed until the owner
does that.

- **The writer leans on breader's stack.** Its API runs on the laptop as its own compose project
  (`infra/compose.yml`, project `writer`), joined to breader's network (`breader_default`). There
  it reaches the CLIProxyAPI breader's worker runs (`worker:8327`), whose management routes answer
  other containers (`allow-remote`), with keys made from breader's `ADMIN_TOKEN` as breader makes
  them. So the writer's model picker and breader's admin page sign the same accounts in and out,
  and the writer and breader's AI marker draw on the same limits. Breader's tunnel sends
  `writer-api.breader.site` to it (`http://writer-api:8790`), so the writer has no tunnel or token
  of its own. The service is `writer-api`, never `api`, which is breader's name on that network.
- **The API's address is `writer-api.breader.site`**, as breader's is `api.`: the app is built with
  `VITE_API_URL` set to it, and the API allows `https://breader.site`. Breader's login cookie is on
  `breader.site` and its subdomains, and the two are one site, so it's sent.
- **`npm run live:env`** (`scripts/live-env.mjs`) writes `infra/.env` from breader's: the
  transaction pooler as `DATABASE_URL`, the session pooler as `SESSION_DATABASE_URL` (the
  migrations' advisory lock and the backup's `pg_dump` need a session), `SESSION_SECRET`, the
  backup key and R2 settings, and the proxy's two keys. Values are copied as breader writes them,
  quotes and all, since compose reads both files the same way. It prints none of them. It and
  `dev-env.mjs` share `scripts/env-file.mjs`.
- **The image** (`server/Dockerfile`, `ghcr.io/anubhav-qt/breader-writer`) runs the server from its
  TypeScript through tsx, as it runs here, so tsx is a dependency of the server, not a dev one. It
  carries CLIProxyAPI too (breader's release and checksums), for the writers' proxy (step 9).
  The same image runs the migrations (`src/migrate.ts`) and the backup (`infra/backup.sh`). CI
  builds it on every push to dev, amd64 and arm64, after the tests; `infra/update.sh` (breader's,
  renamed) pulls it on the laptop every 5 minutes, and the compose `migrate` service migrates
  before the API starts. CI never touches the database.
- **The nightly backup** is a shell script in its own service (`infra/backup.sh`): every 10
  minutes it checks, and once a night after 03:00 India time it dumps the `writer` schema with
  `pg_dump`, encrypts it with `age` to breader's `BACKUP_RECIPIENT`, sends it with `rclone` to
  breader's backup bucket under `writer/daily/` (and `writer/weekly/` on Sundays; R2's lifecycle
  rules need two more prefixes) and keeps 14 on the laptop. A backup goes into place only once R2
  has it, so a failed upload is tried again at the next check.
- **The app is a Worker on breader.site's routes** (`frontend/worker.js`, `frontend/wrangler.jsonc`),
  `breader.site/writer` and `breader.site/writer/*`, in front of breader's Pages site, so the app
  shares breader's origin. It serves the build with `/writer` taken off (the build's files are at
  its root), sends `/writer` to `/writer/`, answers every page of the app with `index.html` and a
  missing file with a 404. Cloudflare's Workers Builds builds and deploys it on every push to dev,
  with no secrets in GitHub. A Worker route running in front of a Pages custom domain is what
  Cloudflare's docs lead us to expect, not something tried: the README has the check, and the
  fallback (a Pages Function in breader handing `/writer/*` on) if it doesn't.
- **Streams say they're still there.** Cloudflare and its tunnel close a connection that's quiet
  for 100 seconds, and a move, a wrap-up or a rewrite's part can think longer than that before its
  next words. Every streamed route (`lib/sse.ts`, `eventStream`) sends a comment line every 20
  seconds, which the app's reader skips.
- Checked here (2026-10-15): the image built and ran against a throwaway database on the dev
  Postgres (the migrations, `/health`, a backup made with a throwaway key, decrypted and listed
  back, the newest 14 kept, and a failed dump leaving nothing in place); the Worker under
  `wrangler dev` answering every path as above; `wrangler deploy --dry-run` taking the config;
  `live:env` and `dev:env` on made-up settings. Not tried: anything on Cloudflare, GitHub or the
  laptop.

### Notes for step 9

All of step 9's design calls are ours (2026-10-15, the owner can change them).

- **`OPEN_TO_ALL`** (off by default) lets every breader account with a confirmed address write.
  The invited (`WRITER_EMAILS`) and the owner are as before; `isInvited` tells them apart from
  everyone else, and the owner must still be invited.
- **The house** is the owner's own AI, the proxy's accounts (`server/src/ai/house.ts`). It writes
  everything for the invited. For anyone else it writes the free chapter: the first scene of their
  first book (the first they made), and setup help while that book is being made and on it. That
  is the openings, every move, undo and another reply and hints in scene 1, its wrap-up and its
  chapter, and a rewrite while the play is in scene 1. Every call says which book and scene its
  work is in (`Work`: setup help is scene 1, going on is the scene it goes to), and past the
  house's reach `modelFor` is a 403, `own_ai_needed`, which says to bring their own AI from the
  model picker. Nothing is held back or marked as a trial before that.
- **The free chapter ends at going on.** Going on from scene 1 needs the writer's own AI, so the
  route wraps scene 1 up on the house first (`wrapUpOnly`, streamed as `finishing`), nudges the
  scribe, and then streams the 403. Scene 2 stays waiting, and the scribe writes chapter 1 on the
  house: the scribe goes only as far as it's told (`through`), so the house never writes a later
  chapter. Settings say where the account stands (`house`: `always`, `first_chapter`, or `used`
  once the first book has a scene 2, waiting or begun).
- **A writer's own AI** comes from keys (below) or sign-ins, and its models join the picker beside
  the house's, each with where it comes from (`ModelSource`: `house`, `google`, `anthropic`,
  `openai`, `signin`), since one id can come from two places. The house's are shown while it
  writes anything for the account. The choice keeps its source (`settings.source`). A call runs
  on the account's own model when it picked one and it's still there; else on the house while the
  house writes the work; else on the first of its own models; else it's the 403 (`modelFor`). So
  a writer who brings a key goes on past the free chapter without picking anything, and the
  scribe writes each chapter on whatever its scene would run on, the house's free one included.
- **Own keys** for Google (the Gemini API), Anthropic and OpenAI, one per provider per account
  (`own_keys`). A key is checked by listing the models it reaches before it's kept, and kept
  sealed with AES-256-GCM under a key made from `KEYS_SECRET` (`ai/own/seal.ts`), so the
  database alone never gives one away. It's never sent back: settings show its provider and last
  four characters. Calls go straight to the provider with it (`ai/own/providers.ts` makes pi's
  models: Gemini 3 thinks low or high, Claude any level, OpenAI's reasoning models can't be off),
  so they draw on the writer's own limits. A server without `KEYS_SECRET` takes no keys;
  `dev:env` and `live:env` make one the first time and keep it after, since a new one loses every
  key kept. Which models a key reaches is read again once a minute at most (`OwnAi`).
- **Own sign-ins** (Antigravity, ChatGPT, Claude) go to **the writers' proxy**, a CLIProxyAPI the
  API runs beside itself (`ai/own/writers_proxy.ts`, as breader's worker runs the house's), never
  the house's: its settings are written fresh at each start, it listens on the API's machine only,
  its keys are made from `KEYS_SECRET`, and it keeps the sign-ins in `WRITERS_PROXY_DIR` (a volume
  on the laptop). The image has its binary; here it's off unless `WRITERS_PROXY_BIN` points at
  Homebrew's. It forces prefixes (`force-model-prefix`), and each writer's sign-ins get a prefix of
  their own (`prefixFor`, from their account), set through `PATCH /credentials/fields`, so a call
  for `<prefix>/<model>` reaches only that writer's: one writer's sign-in never serves another's
  calls, and the house is never touched.
- The proxy doesn't say which credential a sign-in made, so one sign-in runs at a time on the
  server (another writer's start is a 409, `sign_in_busy`, for up to 6 minutes), and once it's
  done, whatever is there that nobody owns is that writer's (`own_sign_ins`). Before a sign-in
  starts, whatever nobody owns is signed out, so a left over sign-in is never taken for someone
  else's. The sign-in itself is the owner's flow: a new tab, and the address it ended on pasted
  in, since the writers' proxy is never on the writer's machine.
- A writer's sign-in models are the writers' proxy's models under their prefix (`bareId` finds
  what the proxy knows about each). Not tried against a real CLIProxyAPI, only the stand-in:
  whether `force-model-prefix` sits under `routing`, whether `/v1/models` lists a prefixed
  credential's models as `<prefix>/<model>` (if it lists them bare, the writer's prefix is put on
  the models of the kinds they signed in), and whether Gemini's route takes a model id with a
  slash. The checklist has the check.
- **"Your AI" in the model picker** is every writer's but the owner's, where the owner's "AI
  accounts" are: a line on what the house writes for them (`settings.house`), their keys (the
  provider and "Key ending in 1234", with Remove and a confirm in place) and their sign-ins (with
  Sign out), then "Add a key: Google, Anthropic, OpenAI" (a paste field, Save checks it with the
  provider, and a key turned away says so) and "Sign in: Antigravity, ChatGPT, Claude", the
  owner's flow against `/v1/own/sign-in`. Each model's row says where it comes from: the house's
  account for the owner and the invited, "On the house" during the free chapter, or "Your Google
  key", "Your ChatGPT sign-in". While the house is offline, or past the free chapter with nothing
  of their own, the picker still shows "Your AI". Checked in headless Chrome against a stand-in
  API (2026-10-15).

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
  token estimates (`utils/estimate.ts`), for the context budget. Moved: whether a model takes
  Gemini's thinking levels (`usesGoogleThinkingLevel`) is in `src/models.ts`, so the server can
  ask without loading Google's SDK.
- `pi-agent`: the agent loop (a reply, its tool calls, their results, again until it's done)
  and its events. Dropped: the proxy transport.

### `shared/` (`@writer/shared`)

- `src/protocol.ts`: the zod shapes the server and the app exchange (`Me`, `Access`,
  `BookCard`, `BookList`, `Settings` with what the house writes for the account (`HouseStanding`),
  where each model comes from (`ModelSource`, on `ModelInfo` and `ModelChoice`), a writer's own AI
  (`KeyProvider`, `OwnKey`, `OwnAi`, `KeyAsk`), and the AI accounts and their sign-ins: `AiAccount`,
  `SignIn`, `SignInStatus`, `SignInAddress`). Change a shape here and both sides get the type
  error.
- `src/book.ts`: what a book is set up with (`BookSetup`): its length (and each length's word
  goal), point of view, darkness (the content level), its world, its characters' sheets and the
  relationships between them (a bond and two sides, `Relationship`). The app makes each
  character's id, so people can be tied before the book is saved. `BookSetup` turns away two
  characters with one id, and a relationship with oneself, with someone not in the cast, or a
  second one between the same two. `pairKey` is a pair's key either way round; `inOrder` puts a
  relationship's smaller id first, as it's stored. How much each field holds is here too
  (`TITLE_LIMIT`, `NAME_LIMIT`, `SHORT_LIMIT`, `LONG_LIMIT`, `NOTES_LIMIT`), and the cast's
  checks (`checkPeople`) are shared with a setup still being filled in.
- `src/setup.ts`: changing a setup: a character's sheet, removing someone (and their
  relationships), and tying, changing and untying relationships. The setup page changes a setup
  through it, and so do Procreator's suggested changes, on the page and on the server alike.
- `src/suggestions.ts`: setup help (step 5). A setup as the page holds it while it's being
  filled in (`DraftSetup`: the title and names may still be blank), a field of it (`FieldRef`:
  the title, a field of the world or of someone's sheet, a line's bond, or one side of a line)
  and its key (`fieldKey`), every field in the page's order (`everyField`) and the blank ones
  (`blankFields`), what's in a field (`fieldText`), changing it (`withFieldText`) and how much
  it holds (`fieldLimit`), the asks and the answers (`FieldAsk`, `FieldSuggestion`, `BlanksAsk`,
  `BlankSuggestions`), and when suggestions start (`filledIn`, against `SUGGEST_AFTER`).
- `src/story.ts`: the story mid play (step 6), for the Story and Notes panels: what they show
  (`StoryView`: the setup as it stands, Procreator's page about each person, the reference as
  `ReferencePage`s and memory as `MemoryNote`s, and whether anything is played), a change the owner
  makes (`StoryEdit`, with the book's choices and world as `BookChoices`, and a page as a
  `PageDraft`), the story's own pages (`PLAN`, `THREADS`, `TIMELINE`, and `isAhead` for the two
  that say where it's going) and
  how far it reaches (`Reach`), asked as `EditAsk`, what one that reached back rewrote
  (`Rewrote`), the edit's streamed events (`EditEvent`), and a rewrite passage by passage, before
  and after (`RewriteView`).
- `src/play.ts`: play (step 6). A turn as the page shows it (`PlayTurn`: its voice, who the
  owner or an actor played, their words, the reply, and the quiet lines after it, `Mark`, a
  rewrite of the past among them), where
  the play stands (`Stage`, `cue` while the owner says who plays someone) and the play itself
  (`Play`, with who is about to act), the asks (`MoveAsk`, with `as` for a move as someone cued,
  `OpenAsk`, and `Going` for going on, another reply and letting an actor play, each with
  `playOthers`), what undo and hints answer (`Undone`, `Hints`), and the streamed events
  (`PlayEvent`). The stage is `finished` once the story has ended and its last scene is wrapped
  up, and the play says how many chapters the book has (`chapters`).
- `src/reading.ts`: the book as it's written (step 7): a chapter (`ChapterView`) and the book as
  the book view shows it (`BookView`: its chapters, the scenes waiting to be written, whether one
  is being written now, and whether the story is finished).
- `src/chat.ts`: the Suggestions chat. A change exactly as it will land (`SetupChange`: a field's
  whole new text, one of the book's choices, someone new, someone removed, two untied) and making
  it (`applyChange`, which ties two first for a line's field, and is null when it doesn't fit),
  a list and how it stands (`ChangeList`), what the chat shows (`ChatEntry`, `Chat`), the asks
  (`ChatSay`, `ChatRedo`, `ChatApprove`), what approving answers (`ChatApproved`: the chat and
  the changes to land), and the streamed events (`ChatEvent`).

### `frontend/` (`@writer/frontend`)

A copy of breader's library page (breader at `2226591`), cut down to the writer's. React 19,
Vite, `motion`. Served under `/writer/` (`base` in `vite.config.ts`).

- `src/App.tsx`: the page the address is on. The library asks the writer's server who is logged
  in, then shows the books, or a quiet note in their place: log in, confirm your email, invite
  only, offline, or no books yet (with New book). New book is in the header once there are books.
  A card opens its book's play, and Start opens the new book's. The play and setup pages load
  on first use (`lazy`), and only for an account that can write; anyone else gets the library
  and its note.
- `src/lib/route.ts`: the pages by address under `/writer/`: the library, `new`, a book's play
  (`books/<id>`), its book (`books/<id>/book`) and its setup (`books/<id>/setup`). Moving between them uses the history, so
  back and links work.
- `src/lib/api.ts`: two servers. The writer's API (`VITE_API_URL`, default `/writer/api` on the
  app's own address; the dev server proxies it to port 8790) and breader's (`VITE_BREADER_API_URL`,
  default `https://api.breader.site`) for logging in. A writer API that can't be reached throws
  `OfflineError`. A request can be given up on (`signal`). `streamEvents` is a POST whose answer
  streams back as server-sent events (the Suggestions chat), with no time limit.
- `src/lib/useMedia.ts`: whether a media query matches, kept up to date as the window changes.
- `src/lib/account.ts`: the account, its access and whether it's the owner, from `/v1/me`,
  remembered under `writer.me.v1`. Logging in, signing up, Google, reset links and logging out
  all go to breader's Better Auth; reset and confirm links open breader. While the server is
  down it's asked again every minute, so the writer comes back by itself.
- `src/data/books.ts`: a book as its card shows it, its length's name, and how much is written
  (words written over the goal, 0 to 1).
- `src/data/setup.ts`: a setup while it's being made: the choices' names and descriptions,
  blank sheets, what's still missing, the draft kept in this browser (with its Suggestions
  chat's id, and turning an old draft's feelings into relationships), and the server calls.
  Changing the cast and the graph is shared's (`shared/src/setup.ts`).
- `src/data/chat.ts`: the Suggestions chat's server calls, and an item of a list as the chat
  shows it (`itemView`: where it lands, its text, and someone new's sheet).
- `src/features/setup/`: the setup page. `SetupPage.tsx` is the page (the book, the world, the
  cast as cards, the relationships); `NewBook.tsx` starts a book from it and `EditSetup.tsx`
  changes one. `CharacterSheet.tsx` is a character's sheet over the page, and
  `RelationshipSheet.tsx` a relationship's; `RelationshipGraph.tsx` draws the graph (SVG, moved
  with `motion`) and `graphLayout.ts` places its dots with `d3-force`, starting from where they
  were so a change nudges the graph instead of shuffling it, and keeping them inside the box. All
  of it is built to open mid story too.
  `Fields.tsx` holds the text fields and radio cards, which are breader's Add a book dialog's
  (`features/add/add.css`, kept whole from breader); `setup.css` is only what the page adds.
  `useGhost.ts` is Procreator's faint text in a field (see "Notes for step 5"): a `Field` told
  which field of the setup it is (`field`) shows the blank fields' suggestion for it, or asks
  for one of its own through `src/data/suggestions.ts`, with the page as it stands from
  `HelpContext`, which `SetupForm` puts around the page and its sheets. `useBlanks.ts` asks
  for the blank fields' suggestions, for `SetupForm` to hand on. A field can't colour part of
  its own text, so the faint text is drawn in a copy of the field laid over it.
  `useChat.ts` holds the Suggestions chat for `SetupForm`, and `SuggestionsChat.tsx` shows it,
  beside the page or over it (`chat.css`); `landing.ts` is how an approved list lands on the
  page (see "Notes for step 5").
- `src/data/play.ts`: play's server calls (the play, the openings and hints, a move and the rest
  streamed, finishing the book, undo), and the switch "Main character and author only" as this
  browser keeps it.
- `src/features/play/`: the play page (see "Notes for step 6"). `usePlay.ts` holds the play as
  the server last said it, and while Procreator writes, what was sent and its words so far
  (`Pending`): a move shows at once, its narration comes in word by word, and a move that fails
  puts the play back as the server answers and the owner's words back in the box.
  `PlayPage.tsx` is the page: the top bar (back, the title, undo, Story, Notes, Book with its new
  chapter mark, the model picker), the scene
  under its heading with its turns (moves as quiet italic lines, notes folded into marks, the
  quiet lines for the cast and relationships, "Another reply" under the newest), what's under
  them as the play stands (the openings, a scene's end and "On to Scene 5", the story's end and
  "Finish the book", "Read the book"), and the hints and
  errors above the box. The page keeps to its end as words come in, unless the owner scrolled
  up. `MoveBox.tsx` is the pinned box, or its ask while someone cued is about to act. `play.css`
  is only what the library's buttons, chips and switch and Add a book's cards and spinner lack.
- `src/data/book.ts` and `src/features/book/`: the book view (see "Notes for step 7"), breader's
  reader cut down. `BookPage.tsx` reads the book (`fetchBook`), makes its chapters a book for the
  reader (`FlowBook`, `types.ts`), and keeps the place and the chapters seen; `Reader.tsx` is the
  reader, `FlowView.tsx` the text in pages or scrolled, `Panels.tsx` the contents and Appearance,
  `chrome/` the lines of controls above and below the text, `chapters.ts` the chapters as
  stretches of the book, `settings.ts` how it reads, `focus.ts` and `fullscreen.ts` full screen,
  `turn.ts` page turns, and `reader.css` and `instrument.css` breader's styles for them, cut down.
  `lib/glide.ts` and `lib/bars.ts` come with them from breader.
- `src/data/story.ts` and `src/features/story/`: the Story panel (see "Notes for step 6").
  `useStory.ts` holds the story as the server last said it, the sheet open over the page and a
  change on its way, for the play page, so closing the panel doesn't stop a change and the quiet
  lines can open a sheet. `StoryPanel.tsx` is the panel (beside the play, or the Suggestions
  chat's sheet over it on a phone): setup's fields, cast cards and graph, and the panel's end.
  `StorySheets.tsx` is the sheets over the page, setup's own `CharacterSheet` and
  `RelationshipSheet` given a footer of their own (`footer`), held until saved, the ask before
  removing or untying, what a rewrite changed, and a page's sheet. `NotesPanel.tsx` is the Notes
  panel, opened the same way. `reach.ts` says how a change saves (plainly, or asking "From now
  on" or "Always so"). `story.css` is only what setup's and the chat's lack.
- `src/features/models/ModelPicker.tsx` and `src/data/models.ts`: the header's model picker,
  for an account that can write. The chip says the model and its thinking level; it drops down
  the models (`GET /v1/settings`, asked again on each opening) and the thinking levels the
  model takes. It's built from what's there: the library's ghost button, the account menu's
  dropdown and items (`account.css`), breader's segmented control (`components/Segmented.tsx`,
  copied from breader's reader settings), and the Add a book dialog's field and buttons
  (`add.css`); `models.css` only adds what those lack. A pick shows at once and is saved
  (`PUT /v1/settings`), and goes back if the server says no. Moving to another model keeps the
  thinking level, or the nearest it takes. For the owner the menu goes on to the AI accounts
  (`Accounts.tsx`, with the server calls in `src/data/accounts.ts`), and for anyone else to their
  own AI (`YourAi.tsx`, with the server calls in `src/data/own.ts`; see "Notes for step 9"), and
  each model says where it comes from (`sourceName`). `useAccounts.ts` and `useOwn.ts` keep them
  in the picker rather than its menu, so a sign-in goes on being asked after while the menu is
  closed; both sign in through `useSignIn.ts`. What opens at the menu's end (a confirm, a key's
  field, a sign-in's wait) scrolls itself into view (`useInView.ts`).
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
  the invite list, and `OWNER_EMAILS` who signs the AI accounts in and out (each a writer too).
  `OPEN_TO_ALL` lets every confirmed account write (step 9), and `KEYS_SECRET` is what writers'
  own keys are sealed with (none are taken without it). `WRITERS_PROXY_BIN`, `WRITERS_PROXY_DIR`
  and `WRITERS_PROXY_PORT` are the writers' proxy for their own sign-ins.
  `CLIPROXY_URL`, `CLIPROXY_API_KEY` and `CLIPROXY_MANAGEMENT_KEY` are the CLIProxyAPI the
  models come through; no URL means the AI is offline, and no management key means no thinking
  levels and no accounts to manage.
- `src/db/schema.ts`: the writer's tables, all in the Postgres schema `writer`: `books` (owner's
  breader user id, title, colour, length, word goal, words written, point of view, darkness),
  `worlds` (one per book), `characters` (role `protagonist`, `cast`, or `left` for someone who
  left the story mid play, in order; the key is the
  book and the app made id together, so no book can reach another's characters) and
  `relationships` (one row per pair, smaller id first, which a check enforces: the bond and each
  side's "sees" and "hides"), and `settings` (one per account: its model, where it comes from and
  its thinking level), `own_keys` (an account's own API keys, sealed) and `own_sign_ins` (whose each
  sign-in on the writers' proxy is).
  The story's own tables follow (see `src/story/`): `scenes` (numbered, one playing at a time,
  with where, when, who is in it and, once wrapped up, its summary), `turns` (the owner's move
  and the reply, word for word, numbered through the book), `changes` and `versions` (the change
  log), `pages` (the reference: a page per subject, by title, or by character for a cast
  member's), `notes` (Procreator's memory), `relationship_history`, `session_segments` and
  `session_messages` (each scene's session), `actor_segments` and `actor_messages` (each
  actor's chat), `chapters` (the book: a chapter per scene written up, by its number, with its
  title, prose and words), and `calls` (each model call and the tokens it used). A turn that stopped for
  the owner to say who plays someone keeps the cue (`turns.cue`). The Suggestions chat's are `setup_chats` (an account's, with its book once there is one,
  and the page as Procreator last saw it), `setup_chat_messages` and `setup_chat_entries`. The story's tables keep no times of their own; the change that made a row has it. A
  session is raw history like turns, only ever added to. drizzle-kit only sees this file and this
  schema.
- `src/books/setup.ts`: a book's setup in and out of those tables. Saving keeps the ids of
  characters who stay and removes only those who left, since later steps hang the story off
  them. Relationships are written whole on each save, and read back in pair order. Reading it
  leaves out whoever left the story, and their lines. `src/books/story.ts` is the story as the
  Story panel shows it (`storyView`), and a rewrite as its quiet line lists it (`rewriteView`).
- `src/ai/`: the models.
  - `proxy.ts` speaks to CLIProxyAPI: the models its accounts serve (`/v1/models`, with the API
    key), and its management API (`manage`, under `/v8/management`, with the management key):
    what it knows about the models, and the accounts. Answers are checked with zod; a proxy that
    can't be reached or says no is a `ProxyError`, with its own words for why (`reason`) when it
    gave them.
  - `accounts.ts`: the AI accounts signed in to the proxy. Listing them (and why one can't
    serve), signing one out, and signing one in: `startSignIn` (with `is_webui`, so the proxy
    takes the callback itself), `signInStatus`, `finishSignIn` with the address the sign-in
    ended on (once `addressProblem` has checked it's this sign-in's), and `cancelSignIn`.
  - `catalog.ts` turns those into pi models (`Catalog`, read again once a minute at most, and at
    once after `forget`, when an account was signed in or out): which of pi's APIs speaks to
    each, by its id, and the thinking levels each takes. Models that draw pictures are left out.
    Without the management key, nothing is known about them, so they show no thinking levels and
    pi sends none, and the model thinks at its own default; nor is it known which draw pictures,
    so those show in the picker too. The default is Gemini 3.8 Flash
    (`gemini-3.8-flash-high` as Antigravity names it), thinking high.
  - `settings.ts` decides the model an account's story runs on (`modelInUse`): its choice while
    an account serves it, else the default, else the first; its thinking moves to the nearest
    level the model takes. What it answers (`InUse`) carries the key its calls take, so a call
    never asks where the model came from.
  - `dashes.ts`: no dashes in anything Procreator writes (see "Writing"). Its instructions say
    so, and what it writes passes through `undashed` anyway (`Undasher` for streamed words,
    holding a dash back until the next words show what it becomes): a comma between words, an
    ellipsis where speech breaks off, a hyphen in a range of numbers, nothing at the start of a
    line or a quote. Setup help's faint text, the chat's words and a list's texts go through it.
- `src/story/`: the story's memory.
  - `changes.ts` is the change log. A change (`startChange`) is tagged with who made it (the
    owner or the agent) and the turn it came from, and every row it touches goes through
    `make`, `edit` or `remove`, which keep the row's version before and after (an edit keeps
    only the columns it changed). `takeBack` puts every row a change touched back as it was, as
    a new change of its own. A change that a later one built on waits until the later one is
    taken back, so nothing is quietly lost; a change and its take-back cancel out, and a
    take-back isn't taken back itself. Undo takes back the newest first.
  - `scenes.ts`: scenes (made waiting as `next`, begun, set, ended, summed up) and turns. Turns
    are raw history: making one isn't a change (changes are tagged with turns), but rewriting
    one is. `cast.ts` brings someone new into the cast (`joinCast`, `seatInCast` with the owner's
    sheet and id) and says who still stands (`standingOf`). `sheets.ts` is the owner's own
    pieces changed mid story: a sheet, someone added, leaving (`leaveCast`) or taken out whole
    (`removePerson`), a line, two untied, the world and the book's choices; `notes.ts` the owner's
    changes from the Notes panel: a page saved or taken out, a note of memory saved or dropped.
    `edits.ts` says what an owner's change did, field by field, for Procreator's note.
  - Only breading_ground calls the writes in `story/` (see "Notes for step 6").
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
    unknown links and a title that takes a cast member's name. A page is as long as its subject
    needs. Plan, Threads and Timeline are story pages by those titles.
  - `memory.ts`: Procreator's notes, each kept on one line, as many as it keeps. The same note
    twice (in any case) is kept once. Remembering and forgetting are changes.
  - `relationships.ts`: shifting a relationship (tying the two first if they weren't, and adding
    to the line's history); `shiftOnce` does nothing when the shift is in place already.
  - `search.ts`: exact words in the pages (as Procreator reads them), the scene summaries, every
    standing turn and the book's chapters, in any case and across line breaks, each match as the paragraph it's
    in. It shows a dozen at a time and the next dozen are a search away (`from`), so every match
    can be reached without a common name pouring hundreds into the session.
  - `session.ts`: a scene's session as it's kept: segments (`startSegment`, `currentSegment`),
    each a head and the messages from its `fromSeq` on, and messages (`addMessage`) of kind
    `play`, `note`, `fold` or `aside`; a segment sends its standing play and notes
    (`segmentMessages`).
    `cutSession` is undo's side: the messages and segments of the turns from one on are marked
    undone, kept. The segment a session opens with is made at no turn, so it's never cut.
  - `actors.ts`: an actor's chat as it's kept, as a session is: segments (each a head, who they
    are as it told them, and what they remember after a compaction), and messages of kind `play`
    or `fold`, each at a turn in a scene, with who they are when a message told them it changed.
    `cutActors` is undo's side.
  - `chapters.ts`: the book's chapters (step 7), kept (`keepChapter`) and counted, with the
    book's words written counted again from them (`recountBook`). breading_ground's alone.
  - `passages.ts`: the story's passages, every text a change that reaches back may rewrite, in
    parts (a scene at a time, its chapter included, then the rest), each with where it is (`passagesOf`), and keeping
    one rewritten through the change log (`rewritePassage`, breading_ground's alone). `wheresOf`
    says where each is, for looking a rewrite over.
  - `read.ts` reads everything a book's story knows in one go (`readStory`), and `view.ts`
    turns it into what the templates take (`briefView`): the people in the scene in full (sheet
    and page) and everyone else in a line, the relationships among those present in full with
    their history and everyone else's as their bond, every earlier scene's summary, the Plan and
    Threads pages, memory, the pages of places the scene's place names, the whole scene before
    word for word, the index (every page but the characters', by kind), and where the story
    stands against its length. Pages and notes show people as links; the rest by plain name.
    `settingsView` is a book's settings as the prompts say them, for setup help too.
- `src/procreator/`: Procreator at work in a scene's session.
  - `brief.ts`: its instructions (`instructionsFor`), a segment's head (`headFor`: the brief,
    and after a compaction the scene so far), and a turn as it's sent (`turnMessage`).
  - `tools.ts`: the memory tools (`read_page`, `write_page`, `edit_page`, `search`,
    `remember`, `forget`, `shift_relationship`), typebox schemas checked by pi before they run.
    Each write is one change, by the agent, at the run's turn, through breading_ground, and
    none is made while Procreator offers openings or moves (a run's `Mode`). The story's
    refusals reach the model as they are; any other failure is logged and the model is told
    it's the writer's.
  - `play.ts`: the play tools (`set_scene`, `join_cast`, `cue`, `send_back`, `end_scene`,
    `end_story`, `offer_openings`, `offer_moves`), and what they did in a run (`Outcome`, and
    `stopped`, when the scene or the story ended or a cue waits for the owner). `toolsFor` is every tool of a run.
  - `actor.ts`: the cast's actors (see "Notes for step 6"): `cueActor`, `sendBack`, `tellActor`
    (what the owner played them doing), and their chats' compaction.
  - `author.ts`: Procreator as the author (step 7): a scene written up as a chapter (`writeUp`),
    its instructions (`authorView`), the ask (`chapterAsk`) and reading the answer (`chapterFrom`).
  - `run.ts`: one exchange (`exchange`): the session sent as it stands (instructions and tool
    declarations, the head, the segment's messages) plus one message, through pi's agent loop,
    tools run one at a time, with no cap on calls or time (a stuck run is stopped by hand,
    through its signal). It ends early once the scene ends or a cue waits for the owner. Every
    message is kept as it ends and every call recorded, so the next call sends exactly this
    one's start and the cache holds. It asks for
    the long cache, under the scene's id (see the caching note in "Notes for step 3"). Its
    answer has the last reply's words (a fold's summary) and all the run's words without dashes
    (a turn's narration), passed on as they stream.
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
    if that fails), then sends the move, or an aside (hints). `askForOpenings` asks in the first
    scene's session before it begins. `addNote` adds a note to a session (breading_ground adds
    the owner's own).
  - `rewrite.ts`: Procreator rewriting the past (`rewritePast`), a part at a time, with
    `rewrite_passages`, whose edits `applyEdits` makes and checks. `rebuild.ts` starts the
    sessions and the actors' chats again from the story as it now reads (`restartCopies`).
- `src/breading_ground.ts`: the one door for changes to the story (see "Notes for step 6").
- `src/play/`: play. `play.ts` is its flows (`askOpenings`, `openStory`, `makeMove`,
  `letActorPlay`, `goOn`, `undo`, `another`, `hintsFor`, and `alone`, one exchange at a time in
  a book), `view.ts` the play as the page shows it (`playView`), and `edits.ts` the owner's
  changes mid story (`changeStory`, with Procreator's rewrite first when one reaches back).
- `src/suggestions/`: setup help. `view.ts` lays out the page as it stands (`setupView`:
  everyone by name, the nameless numbered, two of one name told apart, `refsOf`) and the field
  asked about (`fieldView`: where it is, what's in it, how much it holds, and `lengthFor`, how
  much to suggest). `quick.ts` is their call (`askQuickly`): one ask on the account's model,
  thinking as little as it can (`quick`). `blanks.ts` makes the suggestions for every blank
  field at once (`suggestBlanks`, reading the answer's fills with `fillsFrom`), and `field.ts`
  one for a field with text in it (`suggestField`). `ghost.ts` turns the answer into the faint text (`ghostFrom`): fences,
  labels and quotes around it come off, it's joined to the field's text with a space where one
  is needed, a repeat of that text is gone on from, a line field keeps to one line, and it's cut
  at a word's end to what the field holds. The Suggestions chat: `chats.ts` keeps it (the chat,
  its messages and entries, the open list), `changes.ts` turns what Procreator writes into
  changes as they'll land (`ChangeArgs`, `checkList`, `checkRedo`) and back (`argsOf`), and
  keeps a list's items that still fit the page (`stillFitting`), and
  `chat.ts` runs it (`say`, `redo`, `approve`, and `alone`, one exchange at a time), with its
  tools `propose_changes` and `revise_change`.
- `src/book/`: the book (step 7). `scribe.ts` writes it in the background (`backgroundScribe`,
  `writeMissing`), `view.ts` is the book as the book view shows it (`bookView`), `epub.ts` the
  EPUB, and `zip.ts` a plain zip for it.
- `src/ai/call.ts`: keeping account of model calls (`recordCall`): each in `calls`, with what it
  was for (narrator, author, hints, fold, actor, rewrite, or setup for setup help), the tokens the writer
  counted before sending (`counted`) and what the model says it used, cache reads included. A
  call that comes back with no answer is a `ModelError`.
- `src/prompts/`: the prompts, as Nunjucks templates in `templates/` (`render.ts`). A template
  takes a typed object and only lays it out; a missing value fails the render.
  `procreator/system.njk` is Procreator's instructions (play, narration, scenes, memory);
  `procreator/head.njk` the brief, in XML tags, with the scene so far after a compaction;
  `procreator/read.njk` a page as `read_page` gives it (`partials/page.njk`);
  `partials/scene.njk` turns word for word (an author note and an opening marked as such);
  `procreator/turn.njk` a turn as it's sent; `procreator/openings.njk` and
  `procreator/hints.njk` the asks for openings and moves; `procreator/compact.njk` and
  `procreator/wrap.njk` the folds' requests; `procreator/change.njk` an owner's change from now
  on, as its note; `rewrite/system.njk` and `rewrite/ask.njk` a rewrite of the past (a part's
  passages, numbered, with the change, and the task last). The asks come last, after the session. An actor's
  chat: `actor/system.njk` its instructions, `actor/head.njk` what a segment opens with,
  `actor/self.njk` who they are, `actor/cue.njk` a cue, `actor/director.njk` an answer sent
  back, and `actor/fold.njk` its compaction. `suggestions/field-system.njk` and `suggestions/field.njk` are a
  field's suggestion: the instructions with examples, then the page (`partials/setup.njk`) and
  the field last. `suggestions/blanks-system.njk` and `suggestions/blanks.njk` are the blank
  fields' suggestions: the instructions with an example, then the page and the numbered blanks
  last. `suggestions/chat-system.njk` is the Suggestions chat's instructions, `chat-page.njk` the
  page as it's sent, `chat-say.njk` the owner's words (the page first when it changed) and
  `chat-redo.njk` a redo (the item as it stands and the owner's notes). Written to the Gemini 3 guides (October 2026, checked again 2026-10-07).
- `src/db/breader.ts`: the columns of breader's `users` and `auth_sessions` that the writer
  reads. Breader owns and migrates them; the writer never writes to them.
- `src/lib/login.ts`: reads breader's login. Breader's Better Auth cookie
  (`brdr.session_token`, or `__Secure-brdr.session_token` when secure) holds a session token
  and its HMAC-SHA256 signature (base64) made with `SESSION_SECRET`. The writer checks the
  signature, then looks the token up in breader's tables. Logging in and out stay breader's job.
- `src/lib/access.ts`: `accessFor` decides `logged_out`, `unconfirmed`, `invite_only` or
  `open` (every confirmed account is `open` with `OPEN_TO_ALL`), and `isInvited` whether an
  account is on the invite list; `requireWriter` guards routes that need `open`.
  `src/ai/house.ts` is what the owner's AI writes for an account (`houseReach`, `houseStanding`,
  see "Notes for step 9"). `src/ai/own/` is a writer's own AI: `seal.ts` seals keys, `providers.ts`
  lists the models a key reaches and makes them pi's, and `own.ts` keeps the keys and reads their
  models (`OwnAi`, `Deps.own`). `routes/own.ts` is `GET /v1/own` (the account's keys and sign-ins,
  and whether this server takes either) and `PUT` and `DELETE /v1/own/keys/:provider` (a 400
  `key_refused` when the provider turns the key away, a 503 `keys_off` without `KEYS_SECRET`).
  `ai/own/signins.ts` is a writer's sign-ins on the writers' proxy (`WritersSignIns`, one at a time,
  claimed with the writer's prefix) and `ai/own/writers_proxy.ts` runs that proxy. Their routes:
  `POST /v1/own/sign-in`, `GET`, `POST` and `DELETE /v1/own/sign-in/:state` (the account's own
  sign-in only, a 404 for anyone else's), and `DELETE /v1/own/sign-ins/:name`; a 503 `sign_ins_off`
  where the server runs no writers' proxy. An unconfirmed address is told so
  before the list is checked, so nobody learns whether an email they don't own is invited.
  `isOwner` is a writer whose email is in `OWNER_EMAILS`; `requireOwner` guards the accounts.
- `src/routes/`: `GET /health`; `GET /v1/me` (the account, its access and whether it's the
  owner, for anyone);
  `GET /v1/books` (the account's books, most recent first), `POST /v1/books` (make one from its
  setup), and `GET` and `PUT /v1/books/:id/setup` (what it was set up with), all `open` only.
  Another account's book is a 404, the same as no book. `GET` and `PUT /v1/settings` (the model
  in use and every model to pick from, or `models: null` while the AI is offline), `open` only.
  The AI accounts, the owner's only: `GET /v1/accounts`, `DELETE /v1/accounts/:id` (signs one
  out and gives those left), `POST /v1/accounts/sign-in` (starts one: the page to sign in on,
  and its state), and `GET`, `POST` and `DELETE /v1/accounts/sign-in/:state` (how it stands, the
  address it ended on, and stopping it). Without a proxy or its key they say so, and a key the
  proxy turns away is told apart from the proxy being down. `POST /v1/suggestions/blanks`
  (Procreator's faint text for every blank field, from the page as it stands) and
  `POST /v1/suggestions/field` (for one field with text in it), `open` only: a 503 while the AI
  is offline, a 502 when the model doesn't answer, and a 400 for a field not on the page. The
  Suggestions chat, `open` only: `GET /v1/suggestions/chats?book=` (a book's chat, or null),
  `GET /v1/suggestions/chats/:id`, `POST /v1/suggestions/chats` (the owner says something, in
  the chat given, else the book's, else a new one; streamed, see "Notes for step 5"), and
  `POST /v1/suggestions/chats/:id/redo` and `/approve` (the chat, and the changes for the page
  to land). Another account's chat is a 404, and a list that isn't open any more (or a redo
  Procreator didn't make) a 409. Play, `open` only: `GET /v1/books/:id/play` (the play as the
  page shows it), `POST .../play/openings` (asks for the first scene's openings, once),
  `.../play/open` (the owner's pick or their own opening), `.../play/move` (a move or an author
  note), `.../play/next` (on to the next scene), `.../play/again` (another reply) and
  `.../play/actor` (the one about to act is played by their actor) and `.../play/finish` (the
  story has ended and the owner finishes the book), each streamed: the scene's heading when it's set, `finishing` while the scene before is wrapped
  up, Procreator's words, then the play, or why it couldn't go on (with the play as it stands).
  `.../play/undo` gives the play and the owner's words back, and `.../play/hints` three moves.
  What play can't do as the story stands is a 409. The Story panel, `open` only:
  `GET /v1/books/:id/story` (the story as it stands), `POST /v1/books/:id/story/edits` (an
  owner's change, streamed: how far a rewrite has got, then the story and what was rewritten, or
  why not with the story as it stands; a 503 before it starts when it reaches back while the AI
  is offline) and `GET /v1/books/:id/story/rewrites/:change` (what a rewrite changed, each
  passage before and after). Once anything is played, `PUT .../setup` is a 409 too. The book,
  `open` only (`routes/reading.ts`): `GET /v1/books/:id/book` (the book as it's written so far)
  and `GET /v1/books/:id/epub` (the EPUB, as a download). `routes/ai.ts` is the model an
  account's calls run on for a book and scene (`modelFor`, with the house's 403 past its reach),
  the 503 and 502 every route that calls Procreator gives (a 429 instead
  when the AI account has reached its limit, saying when it resets where the provider says), and the nudge
  to the scribe (`writeTheBook`) that play and the book make.
- `src/app.ts`: CORS with credentials for `ALLOWED_ORIGINS`, writes only from those origins
  (`lib/http.ts`, copied from breader), a 1 MB body limit, JSON errors (`lib/errors.ts`).
  `lib/sse.ts` is every streamed route's server-sent events, with a comment every 20 seconds while
  it's quiet, since Cloudflare and its tunnel close a connection that's quiet for 100 seconds.
- `Dockerfile`: the server's image, run from its TypeScript through tsx (see "Notes for step 8").
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
  read and cached) and keeps what each call was sent. Claude's and OpenAI's streaming routes
  answer with text only, to show what each is asked of its cache (`askedClaude`,
  `askedOpenAI`). It also answers the management routes the
  accounts use (the accounts, signing out, and sign-ins, kept in `signIns`); signing out the
  last account of a kind drops that kind's models. `test/stories.ts` makes books with stories
  in them, through the change log; `test/story.test.ts` covers scenes, turns and the log,
  `test/pages.test.ts` links, pages, memory and search, `test/brief.test.ts` the brief and its
  templates, `test/session.test.ts` sessions (the prefix each call keeps, what each provider is
  asked of its cache, tools, notes, undo), compaction and the wrap-up,
  `test/accounts.test.ts` the AI accounts, and `test/suggestions.test.ts` setup help (the faint
  text made from an answer, the page's names, the blank fields and their fills, the thinking it
  asks for, and the routes), `test/chat.test.ts` the Suggestions chat (lists checked and
  sent back, redos kept in place, the stream, approving, and each account kept to its own),
  `test/dashes.test.ts` the dashes taken out, `test/play.test.ts` play (openings, a pick or
  the owner's own, moves and notes and the quiet lines after them, scenes ending and going on,
  undo, another reply, a turn that fails, hints) and the actors (what a chat holds and is told,
  sending back, undo, and the switch off), `test/session.test.ts` an actor's compaction too,
  `test/edits.test.ts` the owner's changes mid story (the Story panel's story, each change from
  now on and its note, undo leaving them, someone leaving, before anything is played, renames
  and always so reaching back, and the Notes panel's pages and memory), `test/rewrite.test.ts` Procreator's edits to the passages and
  the passages a rename gives it, `test/book.test.ts` the book (reading the author's answer,
  chapters written in order with the one before in view, a chapter that fails and one a rewrite
  overtook, renames reaching chapters, a story ending and being finished, the EPUB, and search),
  `test/door.test.ts` breading_ground as the one door, `test/sse.test.ts` the streams' comments
  while they're quiet, `test/house.test.ts` the house's free chapter, and `test/own.test.ts` a
  writer's own keys and sign-ins. The stand-in proxy lists models as Google's and Anthropic's APIs
  do too, so it stands in for them, and takes prefixes as the writers' proxy does.

### `frontend/worker.js`, `infra/`, `scripts/` and CI

- `frontend/worker.js` and `frontend/wrangler.jsonc`: the Worker that serves the app at
  `breader.site/writer` (see "Notes for step 8").
- `infra/compose.dev.yml`: the dev and test Postgres (`npm run db`). `infra/compose.yml`: the
  laptop's stack (`migrate`, `writer-api`, `backup`), with its settings in `infra/.env` (from
  `infra/.env.example`, written by `npm run live:env`). `infra/backup.sh` the nightly backup,
  `infra/update.sh` the 5 minute check for a new image, and `infra/README.md` setting it all up.
- `scripts/dev-env.mjs` (`npm run dev:env`) writes `server/.env` for running here, and
  `scripts/live-env.mjs` (`npm run live:env`) `infra/.env` for the laptop, both from breader's
  own `infra/.env` through `scripts/env-file.mjs`, printing nothing they read.
- `.github/workflows/ci.yml`: type checks, lint and tests on every push and pull request, then the
  image on pushes to dev.

### Running it locally

The writer runs here against production breader: log in on breader.site as usual, and the local
writer reads that login. Only the writer's own tables are local.

1. Once, the owner adds `127.0.0.1 local.breader.site` to `/etc/hosts` (it needs sudo). Breader's
   login cookie is on `breader.site` and its subdomains, so the app has to be opened as one.
2. `npm run dev:env` (`scripts/dev-env.mjs`) writes `server/.env` from breader's `infra/.env`:
   `SESSION_SECRET`, `COOKIE_SECURE`, and `PRIMARY_URL` and `PRIMARY_SSL` as
   `BREADER_DATABASE_URL` and `BREADER_DATABASE_SSL`. From the CLIProxyAPI Homebrew runs here
   (`/opt/homebrew/etc/cliproxyapi.conf`) it takes `CLIPROXY_URL` and `CLIPROXY_API_KEY`. It
   prints none of them and keeps the rest of `server/.env`. The invited emails go in
   `WRITER_EMAILS` there, the owner's in `OWNER_EMAILS` too, and the proxy's management key in
   `CLIPROXY_MANAGEMENT_KEY` (its config only keeps a hash of it, so it comes from the owner,
   and a wrong one gets this machine shut out of the management API for 30 minutes; see "Notes
   for step 4"). It makes a `KEYS_SECRET` the first time, for writers' own keys, and keeps it.
3. `npm run db`, `npm run migrate`, then `npm run api` (port 8790) and `npm run web` (5174).
4. Open `https://local.breader.site:5174/writer/`. HTTPS is needed because breader's cookie is
   Secure. With mkcert, once (`brew install mkcert`, `mkcert -install`, then `npm run certs`,
   which writes the gitignored `.certs/`), every browser here trusts the certificate. Without
   it, the server makes a self-signed one (`@vitejs/plugin-basic-ssl`), which a browser warns
   about once and the desktop app's own browser refuses.
5. The desktop app's browser loads `https://localhost:5174/writer/` but blocks every script on
   `local.breader.site` (`ERR_BLOCKED_BY_CLIENT`), so it never sees a breader login. Check the
   UI there against a stand-in for the writer's API: a small Node server on port 8790 (with the
   real `api` stopped) that answers `/v1/me` as an invited writer, `/v1/books`, `/v1/settings`
   and whatever is being checked, started from a `launch.json` entry that isn't committed. A
   session without the desktop app (the VS Code extension) checks it the same way in headless
   Chrome: `playwright-core` installed in the session's scratchpad, driving
   `/Applications/Google Chrome.app` with `--ignore-certificate-errors`, and the screenshots read
   back. The preview bar covers the bottom of the page there, so hide `.pv` for screenshots.

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
- **Quality first: no limits on Procreator's work** (the owner's call). It takes as many calls
  as the work needs, with no cap on calls or time, and nothing caps its pages, its memory or its
  notes. Don't add a limit to save tokens or money. One stays only where something would break
  without it: search shows a dozen matches at a time (the rest are a search away), and
  compaction keeps a session inside the model's window.
- **Cache wherever possible** (the owner's words). A cached prefix costs a fraction of a fresh
  one and changes nothing in the answer, so it's the one way to save tokens that fits quality
  first. Keep every session's and actor's chat start the same from call to call, and ask each
  provider for its cache where it has to be asked: for as long as it keeps one, and keyed by
  the session where it takes a key (see the caching note in "Notes for step 3").

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
  - the page of the scene's place, if it has one, and the whole scene before, word for word;
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
  this book. All of it is in every brief, and the owner can see and edit it.
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
  turn played and the written book.
- **Measure it.** Every call is recorded with the tokens counted before sending and what the
  model says it used, cache reads included.

### Actors

Decided 2026-10-06 (see "Every cast member has an actor"), built with play (step 6).

- **Procreator directs; actors play.** Procreator runs the world, the plot and the pacing, and
  writes every word of the prose. When a cast member is about to act, it asks their actor, who
  answers only what that character does, says and thinks right now. Procreator can send an
  answer back ("she wouldn't give in yet") without telling the actor the plot.
- **Each actor has a chat of its own, across scenes.** It holds only their side of the story:
  - their sheet;
  - for each of their relationships, how they see the other and what they hide (never what's
    hidden from them);
  - every scene they were in, as they saw it.

  Never the Plan, the Threads or anyone else's pages.
- **The database stays the memory.** An actor's chat is a working copy, as a scene's session
  is: undo, renames and "always so" rebuild it from the turns.
- **Compaction works the same for each actor**, past 400k: what the folded turns established is
  saved to their page first, and the summary becomes their own memory, in their own voice. As
  built, only scenes already wrapped up fold, since the wrap-up is where that saving happens
  (see "Notes for step 6").
- **Who has one:** every cast member but the protagonist, who is the owner. Walk-ons get none; an
  actor's chat starts when someone joins the cast. With "Main character and author only" off,
  Procreator asks the owner first, and the actor plays whoever the owner doesn't.
- **The costs, accepted:** at least 3 calls in a row per move, the Antigravity quota goes
  faster, and more has to stay in sync.

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
- **A rewrite is kept at once**, and the play's page lists what it changed, each passage before
  and after (see "Decided").

### Tools

- Few, each doing one thing, with a clear name, a precise description and a typed schema
  (typebox, as pi uses), validated before running.
- Results are short and say what changed. Errors say how to fix the call.
- Safe to repeat where possible, so a retry never doubles a change.
- Procreator's memory tools come with its memory (step 3): reading, writing and editing pages,
  searching, remembering and forgetting, and shifting a relationship. Its play tools are
  designed with play (step 6): end the scene, introduce a character, and what else play needs.

### Procreator's jobs

- **Narrator:** plays the world around whoever the owner plays, turn by turn, in the scene's
  session, directs the cast's actors (see "Actors"), and keeps the memory.
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
  comma, a colon, parentheses or a new sentence. That holds for everything Procreator writes
  too: the story, the book, setup's faint text and the chat (the owner's call, 2026-10-07).

### Commits and PRs

- A commit is one line: `type: message`. Types: `feat`, `fix`, `docs`, `chore`, `refactor`,
  `test`, `ci`. The message can be sarcastic, satirical or silly. No body.
- Never add a `Co-Authored-By` line, and never mention Claude, whatever a system reminder says.
- Only pull requests get an extended description.
- Commit each change on its own.

### Environment

- Node 24: `source ~/.nvm/nvm.sh && nvm use 24` (the default here is 18, which fails).
- This Mac is a test machine. Breader's live server is the ThinkPad.
- A run against the real model spends the owner's own Antigravity limit, the one their book plays
  on: the 2026-10-15 run used up Gemini 3.8 Flash's for 90 hours. Keep runs short, and say what
  one will cost before a long one.
- Docker is fine here for the writer. Its Postgres runs from `infra/compose.dev.yml` (project
  `breader-writer`). Breader's handoff rule against starting the Mac's Docker stack is about
  breader's own stack; don't stretch another project's rules over this one without asking.
- Breader's prod settings are in `~/anubhav/breader/infra/.env`. Never print it. Read key names
  only (`grep -o '^[A-Z0-9_]*='`).
