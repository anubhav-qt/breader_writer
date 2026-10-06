import { desc, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { DraftSetup } from '@writer/shared/suggestions';
import type { Catalog } from '../src/ai/catalog.ts';
import { users } from '../src/db/breader.ts';
import { books, calls } from '../src/db/schema.ts';
import { ghostFrom } from '../src/suggestions/ghost.ts';
import { refsOf } from '../src/suggestions/view.ts';
import { account, address, deps, send, writer } from './helpers.ts';
import { antigravity, catalogOf, fakeProxy, promptOf, type FakeProxy, type Reply } from './proxy.ts';

const MARA = '11111111-1111-4111-8111-111111111111';
const IVEN = '22222222-2222-4222-8222-222222222222';
const NOBODY = '33333333-3333-4333-8333-333333333333';
const ANOTHER = '44444444-4444-4444-8444-444444444444';

/** A setup page part way filled in: someone without a name yet, a line between two, blanks. */
function page() {
  return {
    title: 'The Salt Queen',
    color: 'teal',
    length: 'novella',
    pov: 'third_close',
    darkness: 'mature',
    world: { genre: 'Fantasy', tone: '', setting: 'A drowned coast of stilt towns.', rules: '', notes: '' },
    protagonist: { id: MARA, name: 'Mara', who: 'A ferrywoman', personality: 'Stubborn, quick to laugh', past: '', notes: '' },
    cast: [
      { id: IVEN, name: 'Iven', who: 'Her uncle', personality: '', past: '', notes: '' },
      { id: NOBODY, name: '', who: '', personality: '', past: '', notes: '' },
    ],
    relationships: [{ bond: 'Family', a: { id: MARA, sees: 'He raised her.', hides: '' }, b: { id: IVEN, sees: '', hides: '' } }],
  };
}

const proxies: FakeProxy[] = [];

afterEach(async () => {
  for (const proxy of proxies.splice(0)) {
    await proxy.close();
  }
});

/** A fake proxy whose models answer with these replies. */
async function proxyWith(replies: Reply[]) {
  const proxy = await fakeProxy({ ...antigravity(), replies });
  proxies.push(proxy);
  return proxy;
}

/** A writer that can write, with its models from this catalog, its login and its account's id. */
async function setUp(catalog: Catalog | null) {
  const email = address('suggestions');
  const app = writer({ WRITER_EMAILS: [email] }, catalog);
  const cookie = await account(email, true);
  const [user] = await deps.breader.select().from(users).where(eq(users.email, email));
  return { app, cookie, userId: user.id };
}

async function aBook(userId: string): Promise<string> {
  const [book] = await deps.db
    .insert(books)
    .values({ userId, title: 'The Salt Queen', color: 'teal', length: 'novella', wordGoal: 30000, pov: 'third_close', darkness: 'mature' })
    .returning();
  return book.id;
}

async function lastCall(userId: string) {
  const [call] = await deps.db.select().from(calls).where(eq(calls.userId, userId)).orderBy(desc(calls.startedAt)).limit(1);
  return call;
}

describe('ghostFrom', () => {
  it('takes the whole answer for a blank field, without space around it', () => {
    expect(ghostFrom('', '  Wry and salt-stung \n', 'line', 200)).toBe('Wry and salt-stung');
  });

  it('puts a space between the text and the answer, but none before closing punctuation', () => {
    expect(ghostFrom('A ferrywoman', 'who hates the sea', 'long', 4000)).toBe(' who hates the sea');
    expect(ghostFrom('Stubborn, quick to laugh', ', slow to forgive.', 'long', 4000)).toBe(', slow to forgive.');
    expect(ghostFrom('She waited', '… and waited.', 'long', 4000)).toBe('… and waited.');
  });

  it('goes on from a repeat of the text as the model wrote it', () => {
    expect(ghostFrom('Stubborn', 'Stubborn and proud', 'long', 4000)).toBe(' and proud');
    expect(ghostFrom('The city of Ves', 'The city of Vesper, where the tide rules', 'long', 4000)).toBe('per, where the tide rules');
  });

  it('starts a new line where the model does, except in a line field', () => {
    expect(ghostFrom('Loves rain.', '\nHates the sea.\nCollects shells.', 'notes', 20000)).toBe('\nHates the sea.\nCollects shells.');
    expect(ghostFrom('Fantasy', '\nwith pirates', 'line', 200)).toBe(' with pirates');
  });

  it('keeps a line field to one line', () => {
    expect(ghostFrom('', 'Salt\nand  ruin', 'line', 200)).toBe('Salt and ruin');
  });

  it('takes off a fence, a label or quotes around the answer, but not quotes inside it', () => {
    expect(ghostFrom('', '```\nOswin Tarrow\n```', 'line', 80)).toBe('Oswin Tarrow');
    expect(ghostFrom('', 'Suggestion: Oswin Tarrow', 'line', 80)).toBe('Oswin Tarrow');
    expect(ghostFrom('', '"The Salt Queen"', 'line', 120)).toBe('The Salt Queen');
    expect(ghostFrom('', '“The Salt Queen”', 'line', 120)).toBe('The Salt Queen');
    expect(ghostFrom('', '"Aye," she says. "Never."', 'long', 4000)).toBe('"Aye," she says. "Never."');
  });

  it('keeps to what the field holds, cut at the end of a word', () => {
    expect(ghostFrom('Mara', 'Vell of the Drowned Coast', 'line', 20)).toBe(' Vell of the');
    expect(ghostFrom('', 'one two', 'line', 3)).toBe('one');
    expect(ghostFrom('', 'Supercalifragilistic', 'line', 5)).toBe('');
    expect(ghostFrom('x'.repeat(20), 'more', 'line', 20)).toBe('');
  });

  it('is empty when there’s nothing to add', () => {
    expect(ghostFrom('Mara', '', 'line', 80)).toBe('');
    expect(ghostFrom('Mara', '   \n', 'line', 80)).toBe('');
    expect(ghostFrom('Mara', 'Mara', 'line', 80)).toBe('');
    expect(ghostFrom('', '""', 'line', 80)).toBe('');
  });
});

describe('refsOf', () => {
  it('names everyone by their name, numbers the nameless, and tells two of a name apart', () => {
    const setup = DraftSetup.parse({
      ...page(),
      cast: [
        { id: IVEN, name: 'Iven', who: '', personality: '', past: '', notes: '' },
        { id: NOBODY, name: '', who: '', personality: '', past: '', notes: '' },
        { id: ANOTHER, name: 'mara', who: '', personality: '', past: '', notes: '' },
      ],
    });
    const refs = refsOf(setup);
    expect([...refs.values()]).toEqual(['Mara', 'Iven', 'Unnamed 1', 'mara (2)']);
  });
});

describe('POST /v1/suggestions/field', () => {
  const field = { kind: 'character', id: MARA, field: 'who' };

  it('is closed without a login', async () => {
    const proxy = await proxyWith([{ text: 'Nothing.' }]);
    const r = await send(writer({}, catalogOf(proxy)), 'POST', '/v1/suggestions/field', '', { setup: page(), field, bookId: null });
    expect(r.status).toBe(401);
  });

  it('says the AI is offline without a proxy, or while it’s down', async () => {
    const none = await setUp(null);
    const unset = await send(none.app, 'POST', '/v1/suggestions/field', none.cookie, { setup: page(), field, bookId: null });
    expect(unset.status).toBe(503);
    expect(unset.body.code).toBe('ai_offline');

    const gone = await fakeProxy(antigravity());
    await gone.close();
    const down = await setUp(catalogOf(gone));
    const r = await send(down.app, 'POST', '/v1/suggestions/field', down.cookie, { setup: page(), field, bookId: null });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('ai_offline');
  });

  it('turns away a field that isn’t on the page', async () => {
    const proxy = await proxyWith([{ text: 'Nothing.' }]);
    const { app, cookie } = await setUp(catalogOf(proxy));
    const gone = { kind: 'character', id: ANOTHER, field: 'past' };
    const r = await send(app, 'POST', '/v1/suggestions/field', cookie, { setup: page(), field: gone, bookId: null });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('no_field');
    // Two who aren't tied have no sides to fill in.
    const untied = { kind: 'side', id: IVEN, other: NOBODY, field: 'hides' };
    const out = await send(app, 'POST', '/v1/suggestions/field', cookie, { setup: page(), field: untied, bookId: null });
    expect(out.status).toBe(400);
    expect(proxy.asked).toHaveLength(0);
  });

  it('asks from the page as it stands, the field last, and answers with the faint text', async () => {
    const proxy = await proxyWith([{ text: 'who hates the sea' }]);
    const { app, cookie } = await setUp(catalogOf(proxy));
    const r = await send(app, 'POST', '/v1/suggestions/field', cookie, { setup: page(), field, bookId: null });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ text: ' who hates the sea' });

    const [asked] = proxy.asked;
    const { system, user } = promptOf(asked);
    expect(system.startsWith('You are Procreator.')).toBe(true);
    expect(system).toContain('<examples>');
    expect(user.startsWith('<book>\nTitle: The Salt Queen\nLength: a novella of about 30,000 words')).toBe(true);
    expect(user).toContain('Tone: (blank)');
    expect(user).toContain('<person ref="Mara" played_by="the owner">\nName: Mara\nWho they are: A ferrywoman');
    expect(user).toContain('<person ref="Unnamed 1">\nName: (blank)');
    expect(user).toContain('<line between="Mara and Iven">\nWhat they are to each other: Family\nHow Mara sees Iven: He raised her.');
    expect(user).toContain("Where: Mara's sheet (the one the owner plays): who they are");
    expect(user).toContain('<written>\nA ferrywoman\n</written>');
    expect(user.endsWith('Suggest what comes next in this field: a sentence or two, going on from where it stops. Answer with only the words to add.')).toBe(true);
    expect(asked.body.generationConfig?.thinkingConfig?.thinkingLevel).toBe('HIGH');
  });

  it('asks for the length a field holds', async () => {
    const proxy = await proxyWith([{ text: 'Oswin Tarrow' }]);
    const { app, cookie } = await setUp(catalogOf(proxy));
    const nameless = { kind: 'character', id: NOBODY, field: 'name' };
    const r = await send(app, 'POST', '/v1/suggestions/field', cookie, { setup: page(), field: nameless, bookId: null });
    expect(r.body).toEqual({ text: 'Oswin Tarrow' });
    const { user } = promptOf(proxy.asked[0]);
    expect(user).toContain("Where: Unnamed 1's sheet: name");
    expect(user).toContain('<written>\n(nothing yet)\n</written>');
    expect(user).toContain('Suggest what comes next in this field: a few words, on one line.');
  });

  it('records the call as setup help, with the book only if it’s the account’s', async () => {
    const proxy = await proxyWith([{ text: 'who hates the sea', read: 900 }]);
    const { app, cookie, userId } = await setUp(catalogOf(proxy));
    const bookId = await aBook(userId);
    await send(app, 'POST', '/v1/suggestions/field', cookie, { setup: page(), field, bookId });
    const mine = await lastCall(userId);
    expect(mine).toMatchObject({ role: 'setup', bookId, sceneId: null, turnId: null, model: 'gemini-3.8-flash-high', thinking: 'high', input: 900 });

    const other = await setUp(catalogOf(proxy));
    const theirs = await aBook(other.userId);
    await send(app, 'POST', '/v1/suggestions/field', cookie, { setup: page(), field, bookId: theirs });
    const kept = await lastCall(userId);
    expect(kept.bookId).toBeNull();
  });

  it('says so when the model doesn’t answer', async () => {
    const proxy = await proxyWith([{ status: 400 }]);
    const { app, cookie } = await setUp(catalogOf(proxy));
    const r = await send(app, 'POST', '/v1/suggestions/field', cookie, { setup: page(), field, bookId: null });
    expect(r.status).toBe(502);
    expect(r.body.code).toBe('ai_failed');
  });
});
