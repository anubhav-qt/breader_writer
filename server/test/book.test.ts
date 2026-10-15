import { and, asc, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { PlayEvent, type Play } from '@writer/shared/play';
import { EditEvent } from '@writer/shared/story';
import type { Catalog } from '../src/ai/catalog.ts';
import { newestChange, REWROTE, writeChapter } from '../src/breading_ground.ts';
import { writeMissing, type Scribe } from '../src/book/scribe.ts';
import { users } from '../src/db/breader.ts';
import { books, calls, changes, chapters, scenes } from '../src/db/schema.ts';
import { chapterFrom } from '../src/procreator/author.ts';
import type { Procreator } from '../src/procreator/run.ts';
import { startChange } from '../src/story/changes.ts';
import { searchStory } from '../src/story/search.ts';
import { ORIGIN, account, address, call, deps, writer, type Writer } from './helpers.ts';
import { antigravity, catalogOf, fakeProxy, promptOf, type FakeProxy, type Reply } from './proxy.ts';
import { aBook } from './stories.ts';

/*
 * The book (step 7): each scene, once it's wrapped up, written into the book as a chapter by the
 * scribe in the background; the story's end and the book finished; the EPUB.
 */

const db = deps.db;
const proxies: FakeProxy[] = [];

afterEach(async () => {
  for (const proxy of proxies.splice(0)) {
    await proxy.close();
  }
});

/** A scribe that writes when nudged, and lets a test wait for it. */
function testScribe() {
  let writing: Promise<number> = Promise.resolve(0);
  const scribe: Scribe = {
    // A chapter that fails is let go, as the server's scribe lets it go, to be tried again.
    nudge: (ai: Procreator, bookId: string) => {
      writing = writing.then(() => writeMissing(ai, bookId)).catch(() => 0);
    },
    busy: () => false,
  };
  return { scribe, done: () => writing };
}

function offering(): Reply {
  const openings = [
    { opening: 'The night of the fire, Aiko wakes to bells.', where: 'The Lamp House', when: 'The night of the fire', who: ['Aiko'] },
    { opening: 'Ren pulls Aiko from the river.', where: 'The ferry', when: 'Dawn', who: ['Aiko', 'Ren'] },
    { opening: 'A letter from Sora comes, years too late.', where: 'The post office', when: 'Spring', who: ['Sora'] },
  ];
  return { calls: [{ name: 'offer_openings', args: { openings } }] };
}

const ENDING: Reply = {
  text: 'The doors close.',
  calls: [{ name: 'end_scene', args: { where: 'The north road', when: 'Two days later', who: ['Ren'] } }],
};

function chapter(title: string, body: string): Reply {
  return { text: `<title>${title}</title>\n<chapter>\n${body}\n</chapter>` };
}

/** A writer with a book whose story has opened on the ferry, with a scribe, and the replies after that in line. */
async function opened(after: Reply[]) {
  const proxy = await fakeProxy({ ...antigravity(), replies: [offering(), { text: 'The river is cold.' }, ...after] });
  proxies.push(proxy);
  const email = address('book');
  const { scribe, done } = testScribe();
  const catalog: Catalog = catalogOf(proxy);
  const app = writer({ WRITER_EMAILS: [email] }, catalog, scribe);
  const cookie = await account(email, true);
  const [user] = await deps.breader.select().from(users).where(eq(users.email, email));
  const book = await aBook(user.id);
  await ask(app, cookie, book.bookId, 'openings');
  await ask(app, cookie, book.bookId, 'open', { kind: 'pick', opening: 1 });
  return { proxy, app, cookie, done, userName: user.name, ...book };
}

/** A play route's answer: the stream's events, or its JSON. */
async function ask(app: Writer, cookie: string, bookId: string, path: string, body: unknown = {}) {
  const headers: Record<string, string> = { origin: ORIGIN, 'content-type': 'application/json', cookie };
  const res = await app.request(`/v1/books/${bookId}/play/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  const type = res.headers.get('content-type') ?? '';
  if (!type.startsWith('text/event-stream')) {
    return { status: res.status, events: [] as PlayEvent[], body: JSON.parse(text) };
  }
  const events: PlayEvent[] = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      events.push(PlayEvent.parse(JSON.parse(line.slice('data: '.length))));
    }
  }
  return { status: res.status, events, body: null };
}

function playOf(events: PlayEvent[]): Play {
  const last = events.at(-1);
  if (!last || last.type !== 'done') {
    throw new Error(`the stream ended with ${JSON.stringify(last)}`);
  }
  return last.play;
}

async function chaptersIn(bookId: string) {
  return db.select().from(chapters).where(eq(chapters.bookId, bookId)).orderBy(asc(chapters.number));
}

async function wordsWritten(bookId: string): Promise<number> {
  const [book] = await db.select().from(books).where(eq(books.id, bookId));
  return book.wordsWritten;
}

/** The calls the author made. */
async function authorCalls(bookId: string) {
  return db
    .select()
    .from(calls)
    .where(and(eq(calls.bookId, bookId), eq(calls.role, 'author')));
}

/** The files of a zip stored without compression, by path, in order. */
function unzipped(data: Uint8Array): { path: string; text: string; method: number }[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const files: { path: string; text: string; method: number }[] = [];
  let at = 0;
  const decoder = new TextDecoder();
  while (view.getUint32(at, true) === 0x04034b50) {
    const method = view.getUint16(at + 8, true);
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const extra = view.getUint16(at + 28, true);
    const path = decoder.decode(data.subarray(at + 30, at + 30 + nameLength));
    const start = at + 30 + nameLength + extra;
    files.push({ path, method, text: decoder.decode(data.subarray(start, start + size)) });
    at = start + size;
  }
  return files;
}

describe('chapterFrom', () => {
  it('takes the title and the chapter from their tags, paragraphs a blank line apart, without dashes', () => {
    const written = chapterFrom('<title>The River—At Night</title>\n<chapter>\nAiko crossed.\nRen followed—slowly.\n\n\nThe end.\n</chapter>');
    expect(written).toEqual({ title: 'The River, At Night', body: 'Aiko crossed.\n\nRen followed, slowly.\n\nThe end.' });
  });

  it('takes the first line as the title when there are no tags, and keeps a chapter cut off before its end', () => {
    expect(chapterFrom('# The River\nAiko crossed.')).toEqual({ title: 'The River', body: 'Aiko crossed.' });
    expect(chapterFrom('<title>The River</title><chapter>Aiko crossed.')).toEqual({ title: 'The River', body: 'Aiko crossed.' });
    expect(chapterFrom('<title>The River</title>')).toBeNull();
  });
});

describe('the book', () => {
  it('writes each scene into the book once it’s wrapped up, in order, with the chapter before in view', async () => {
    const { app, cookie, bookId, done } = await opened([
      ENDING,
      { text: 'Aiko and Ren crossed the river.' },
      { text: 'Rain followed them.' },
      chapter('The Crossing', 'Aiko pulled the oars.\n\nRen said nothing & watched the bank.'),
    ]);
    const ended = playOf((await ask(app, cookie, bookId, 'move', { voice: 'character', text: 'I leave.' })).events);
    // Until the owner goes on, the scene can still be taken back, so it isn't written.
    await done();
    expect(await chaptersIn(bookId)).toEqual([]);
    expect(ended.chapters).toBe(0);

    await ask(app, cookie, bookId, 'next');
    await done();
    const [first] = await chaptersIn(bookId);
    expect(first).toMatchObject({ number: 1, title: 'The Crossing', body: 'Aiko pulled the oars.\n\nRen said nothing & watched the bank.', words: 11 });
    expect(await wordsWritten(bookId)).toBe(11);
    const [made] = await db.select().from(changes).where(and(eq(changes.bookId, bookId), eq(changes.what, 'Wrote chapter 1')));
    expect(made.by).toBe('agent');

    const [authored] = await authorCalls(bookId);
    expect(authored).toBeDefined();
    const prompt = promptOf(proxies[0].asked.at(-1)!);
    expect(prompt.system).toContain('here you are the author');
    expect(prompt.system).toContain('Give the chapter a short title');
    expect(prompt.user).toContain('<move by="Aiko">I leave.</move>');
    expect(prompt.user).toContain('<scene number="1" where="The ferry" when="Dawn">');
    expect(prompt.user.trim().endsWith('</task>')).toBe(true);
    expect(prompt.user).not.toContain('<previous_chapter');

    const play = await call(app, 'GET', `/v1/books/${bookId}/play`, cookie);
    expect(play.body.chapters).toBe(1);
    const view = await call(app, 'GET', `/v1/books/${bookId}/book`, cookie);
    expect(view.body).toMatchObject({
      title: 'The Lantern Road',
      chapters: [{ number: 1, title: 'The Crossing', words: 11 }],
      waiting: [],
      wordsWritten: 11,
      wordGoal: 30000,
      finished: false,
    });
  });

  it('gives the chapter before to the next, and tries a chapter that failed again when nudged', async () => {
    const ending2 = { text: 'Night falls.', calls: [{ name: 'end_scene', args: { where: 'The inn', when: 'That night', who: ['Ren'] } }] };
    const { app, cookie, bookId, done, proxy } = await opened([
      ENDING,
      { text: 'Scene one, summed up.' },
      { text: 'The road is long.' },
      { status: 500 },
      ending2,
      // Tried again after the next move.
      chapter('The Crossing', 'Aiko crossed.'),
      { text: 'Scene two, summed up.' },
      { text: 'The inn is warm.' },
      chapter('The Road', 'They walked.'),
    ]);
    await ask(app, cookie, bookId, 'move', { voice: 'character', text: 'I leave.' });
    await ask(app, cookie, bookId, 'next');
    // The author's call failed: nothing is kept, and it's tried again the next time.
    await done();
    expect(await chaptersIn(bookId)).toEqual([]);

    await ask(app, cookie, bookId, 'move', { voice: 'character', text: 'I walk on.' });
    await done();
    expect((await chaptersIn(bookId)).map((each) => each.title)).toEqual(['The Crossing']);
    await ask(app, cookie, bookId, 'next');
    await done();
    const written = await chaptersIn(bookId);
    expect(written.map((each) => [each.number, each.title])).toEqual([
      [1, 'The Crossing'],
      [2, 'The Road'],
    ]);
    expect(await wordsWritten(bookId)).toBe(4);
    const second = promptOf(proxy.asked.at(-1)!);
    expect(second.user).toContain('<previous_chapter number="1" title="The Crossing">\nAiko crossed.\n</previous_chapter>');
  });

  it('keeps nothing of a chapter read before a change rewrote the past', async () => {
    const { app, cookie, bookId } = await opened([ENDING, { text: 'Scene one, summed up.' }, { text: 'The road is long.' }]);
    await ask(app, cookie, bookId, 'move', { voice: 'character', text: 'I leave.' });
    await ask(app, cookie, bookId, 'next');
    const [first] = await db.select().from(scenes).where(and(eq(scenes.bookId, bookId), eq(scenes.number, 1)));
    const since = await newestChange(db, bookId);
    await db.transaction((tx) => startChange(tx, { bookId, turnId: null, by: 'owner', what: 'Renamed Ren Renji', why: REWROTE }));
    const writer = { bookId, turnId: null, by: 'agent' as const };
    expect(await writeChapter(db, writer, first, { title: 'Old', body: 'Ren rowed.' }, since)).toBeNull();
    expect(await chaptersIn(bookId)).toEqual([]);
    const kept = await writeChapter(db, writer, first, { title: 'New', body: 'Renji rowed.' }, await newestChange(db, bookId));
    expect(kept).toMatchObject({ title: 'New', words: 2 });
  });

  it('rewrites the book with a rename, and counts its words again apart from the rewrite', async () => {
    const { app, cookie, bookId, ren, done } = await opened([
      ENDING,
      { text: 'Scene one, summed up.' },
      { text: 'The road is long.' },
      chapter('Ren on the River', 'Ren rowed hard.'),
      { calls: [{ name: 'rewrite_passages', args: { edits: [{ passage: 2, text: 'Renji’s Long Night on the River' }, { passage: 3, text: 'Renji rowed hard and long.' }] } }] },
      { calls: [{ name: 'rewrite_passages', args: { edits: [] } }] },
    ]);
    await ask(app, cookie, bookId, 'move', { voice: 'character', text: 'I leave.' });
    await ask(app, cookie, bookId, 'next');
    await done();
    expect(await wordsWritten(bookId)).toBe(3);

    const headers = { origin: ORIGIN, 'content-type': 'application/json', cookie };
    const edit = { kind: 'sheet', character: { ...ren, name: 'Renji' } };
    const res = await app.request(`/v1/books/${bookId}/story/edits`, { method: 'POST', headers, body: JSON.stringify({ edit, reach: 'now' }) });
    const events = (await res.text())
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => EditEvent.parse(JSON.parse(line.slice(6))));
    const last = events.at(-1);
    expect(last?.type).toBe('done');

    const [first] = await chaptersIn(bookId);
    expect(first).toMatchObject({ title: 'Renji’s Long Night on the River', body: 'Renji rowed hard and long.', words: 5 });
    expect(await wordsWritten(bookId)).toBe(5);
    if (last?.type !== 'done' || !last.rewrote?.change) {
      throw new Error('the rename rewrote nothing');
    }
    const listed = await call(app, 'GET', `/v1/books/${bookId}/story/rewrites/${last.rewrote.change}`, cookie);
    const wheres = listed.body.passages.map((passage: { where: string }) => passage.where);
    expect(wheres).toEqual(['Chapter 1 of the book: its title', 'Chapter 1 of the book']);
  });

  it('ends the story: its ending can be taken back until the owner finishes the book, then it’s written', async () => {
    const ending: Reply = { text: 'And so it ended.', calls: [{ name: 'end_story', args: {} }] };
    const { app, cookie, bookId, done } = await opened([
      ending,
      ending,
      { text: 'The last scene, summed up.' },
      chapter('The End of the River', 'It ended.'),
    ]);
    const first = playOf((await ask(app, cookie, bookId, 'move', { voice: 'character', text: 'I sit down.' })).events);
    expect(first).toMatchObject({ stage: 'ended', scene: { number: 1 }, next: null });

    const undone = await ask(app, cookie, bookId, 'undo');
    expect(undone.body).toMatchObject({ words: 'I sit down.', play: { stage: 'playing' } });

    await ask(app, cookie, bookId, 'move', { voice: 'character', text: 'I sit down for good.' });
    const finished = await ask(app, cookie, bookId, 'finish');
    expect(finished.events.some((event) => event.type === 'finishing')).toBe(true);
    expect(playOf(finished.events)).toMatchObject({ stage: 'finished', next: null });
    await done();
    const refused = await ask(app, cookie, bookId, 'undo');
    expect(refused.status).toBe(409);

    const view = await call(app, 'GET', `/v1/books/${bookId}/book`, cookie);
    expect(view.body).toMatchObject({ finished: true, waiting: [], chapters: [{ number: 1, title: 'The End of the River' }] });
  });

  it('downloads as an EPUB: its mimetype first, a contents page, and a section a chapter', async () => {
    const { app, cookie, bookId, done, userName } = await opened([
      ENDING,
      { text: 'Scene one, summed up.' },
      { text: 'The road is long.' },
      chapter('The Crossing', 'Aiko pulled the oars.\n\n"Faster," Ren said. Fish & chips.'),
    ]);
    await ask(app, cookie, bookId, 'move', { voice: 'character', text: 'I leave.' });
    await ask(app, cookie, bookId, 'next');
    await done();

    const res = await app.request(`/v1/books/${bookId}/epub`, { headers: { origin: ORIGIN, cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/epub+zip');
    expect(res.headers.get('content-disposition')).toBe("attachment; filename*=UTF-8''The%20Lantern%20Road.epub");
    const files = unzipped(new Uint8Array(await res.arrayBuffer()));
    expect(files.map((file) => file.path)).toEqual([
      'mimetype',
      'META-INF/container.xml',
      'OEBPS/content.opf',
      'OEBPS/nav.xhtml',
      'OEBPS/title.xhtml',
      'OEBPS/chapter-1.xhtml',
    ]);
    expect(files[0]).toEqual({ path: 'mimetype', method: 0, text: 'application/epub+zip' });
    const opf = files[2].text;
    expect(opf).toContain(`<dc:identifier id="book-id">urn:uuid:${bookId}</dc:identifier>`);
    expect(opf).toContain('<dc:title>The Lantern Road</dc:title>');
    expect(opf).toContain(`<dc:creator>${userName}</dc:creator>`);
    expect(opf).toContain('<itemref idref="chapter-1"/>');
    expect(files[3].text).toContain('<li><a href="chapter-1.xhtml">Chapter 1: The Crossing</a></li>');
    const page = files[5].text;
    expect(page).toContain('<h1>Chapter 1</h1>\n<h2>The Crossing</h2>');
    expect(page).toContain('<p>Aiko pulled the oars.</p>\n<p>&quot;Faster,&quot; Ren said. Fish &amp; chips.</p>');
  });

  it('is searched with the rest of the story', async () => {
    const { app, cookie, bookId, done } = await opened([
      ENDING,
      { text: 'Scene one, summed up.' },
      { text: 'The road is long.' },
      chapter('The Crossing', 'The heron watched them go.'),
    ]);
    await ask(app, cookie, bookId, 'move', { voice: 'character', text: 'I leave.' });
    await ask(app, cookie, bookId, 'next');
    await done();
    const recall = await searchStory(db, bookId, 'the heron');
    expect(recall.matches).toEqual([{ where: 'Chapter 1 of the book', text: 'The heron watched them go.' }]);
  });
});
