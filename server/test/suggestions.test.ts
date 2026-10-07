import { desc, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { DraftSetup, blankFields, fieldKey, fieldText, withFieldText } from '@writer/shared/suggestions';
import type { Catalog } from '../src/ai/catalog.ts';
import { users } from '../src/db/breader.ts';
import { books, calls } from '../src/db/schema.ts';
import { fillsFrom } from '../src/suggestions/blanks.ts';
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

  it('turns any dash into what fits in its place, as everything Procreator writes', () => {
    expect(ghostFrom('', 'Wry\u2014and salt-stung', 'line', 200)).toBe('Wry, and salt-stung');
    expect(ghostFrom('Stubborn', 'and proud \u2014 too proud', 'long', 4000)).toBe(' and proud, too proud');
  });
});

describe('blankFields', () => {
  it('lists every field with nothing in it, in the page’s order', () => {
    const setup = DraftSetup.parse(page());
    const keys = blankFields(setup).map(fieldKey);
    expect(keys).toEqual([
      'world tone',
      'world rules',
      'world notes',
      `character ${MARA} past`,
      `character ${MARA} notes`,
      `character ${IVEN} personality`,
      `character ${IVEN} past`,
      `character ${IVEN} notes`,
      `character ${NOBODY} name`,
      `character ${NOBODY} who`,
      `character ${NOBODY} personality`,
      `character ${NOBODY} past`,
      `character ${NOBODY} notes`,
      `side ${MARA} ${IVEN} hides`,
      `side ${IVEN} ${MARA} sees`,
      `side ${IVEN} ${MARA} hides`,
    ]);
  });
});

describe('withFieldText', () => {
  it('changes one field, wherever it is, and leaves the rest', () => {
    const setup = DraftSetup.parse(page());
    const titled = withFieldText(setup, { kind: 'title' }, 'Brine');
    expect(titled?.title).toBe('Brine');
    const toned = withFieldText(setup, { kind: 'world', field: 'tone' }, 'Wry');
    expect(toned?.world).toEqual({ ...setup.world, tone: 'Wry' });
    const named = withFieldText(setup, { kind: 'character', id: NOBODY, field: 'name' }, 'Oswin');
    expect(named?.cast[1].name).toBe('Oswin');
    expect(named?.cast[0]).toEqual(setup.cast[0]);
    const hidden = { kind: 'side', id: IVEN, other: MARA, field: 'hides' } as const;
    const hiding = withFieldText(setup, hidden, 'The boat.');
    expect(hiding && fieldText(hiding, hidden)).toBe('The boat.');
    expect(hiding?.relationships[0].a).toEqual(setup.relationships[0].a);
    expect(setup.title).toBe('The Salt Queen');
  });

  it('is null for a field not on the page', () => {
    const setup = DraftSetup.parse(page());
    expect(withFieldText(setup, { kind: 'character', id: ANOTHER, field: 'past' }, 'x')).toBeNull();
    expect(withFieldText(setup, { kind: 'bond', a: IVEN, b: NOBODY }, 'x')).toBeNull();
  });
});

describe('fillsFrom', () => {
  it('reads each fill by its number, keeping the first of two', () => {
    const answer = '<fill n="1">Wry</fill>\n<fill n=\'2\'>Oswin\nTarrow</fill> <fill n="1">Again</fill>';
    expect([...fillsFrom(answer)]).toEqual([
      [1, 'Wry'],
      [2, 'Oswin\nTarrow'],
    ]);
  });

  it('finds nothing in an answer without fills', () => {
    expect(fillsFrom('Wry and salt-stung').size).toBe(0);
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
    // The account thinks high, but a suggestion has to land before the owner starts typing.
    expect(asked.body.generationConfig?.thinkingConfig?.thinkingLevel).toBe('LOW');
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
    expect(mine).toMatchObject({ role: 'setup', bookId, sceneId: null, turnId: null, model: 'gemini-3.8-flash-high', thinking: 'low', input: 900 });

    const other = await setUp(catalogOf(proxy));
    const theirs = await aBook(other.userId);
    await send(app, 'POST', '/v1/suggestions/field', cookie, { setup: page(), field, bookId: theirs });
    const kept = await lastCall(userId);
    expect(kept.bookId).toBeNull();
  });

  it('asks Gemini 3 to think low even when the catalog can’t tell that it thinks', async () => {
    const proxy = await proxyWith([{ text: 'who hates the sea' }]);
    // Without the management key, the catalog knows no thinking levels.
    const { app, cookie, userId } = await setUp(catalogOf(proxy, ''));
    const r = await send(app, 'POST', '/v1/suggestions/field', cookie, { setup: page(), field, bookId: null });
    expect(r.body).toEqual({ text: ' who hates the sea' });
    const [asked] = proxy.asked;
    expect(asked.body.generationConfig?.thinkingConfig?.thinkingLevel).toBe('LOW');
    const mine = await lastCall(userId);
    expect(mine.thinking).toBe('low');
  });

  it('asks any other model for the least thinking it takes', async () => {
    const proxy = await proxyWith([{ text: 'who hates the sea' }]);
    const { app, cookie, userId } = await setUp(catalogOf(proxy));
    await send(app, 'PUT', '/v1/settings', cookie, { model: 'claude-sonnet-4-6', thinking: 'high' });
    const r = await send(app, 'POST', '/v1/suggestions/field', cookie, { setup: page(), field, bookId: null });
    expect(r.body).toEqual({ text: ' who hates the sea' });
    const [asked] = proxy.askedClaude;
    expect(asked.thinking).toEqual({ type: 'disabled' });
    const mine = await lastCall(userId);
    expect(mine).toMatchObject({ model: 'claude-sonnet-4-6', thinking: 'off' });
  });

  it('says so when the model doesn’t answer', async () => {
    const proxy = await proxyWith([{ status: 400 }]);
    const { app, cookie } = await setUp(catalogOf(proxy));
    const r = await send(app, 'POST', '/v1/suggestions/field', cookie, { setup: page(), field, bookId: null });
    expect(r.status).toBe(502);
    expect(r.body.code).toBe('ai_failed');
  });
});

describe('POST /v1/suggestions/blanks', () => {
  it('is closed without a login, and says the AI is offline without a proxy', async () => {
    const proxy = await proxyWith([{ text: 'Nothing.' }]);
    const r = await send(writer({}, catalogOf(proxy)), 'POST', '/v1/suggestions/blanks', '', { setup: page(), bookId: null });
    expect(r.status).toBe(401);
    const none = await setUp(null);
    const off = await send(none.app, 'POST', '/v1/suggestions/blanks', none.cookie, { setup: page(), bookId: null });
    expect(off.status).toBe(503);
    expect(off.body.code).toBe('ai_offline');
  });

  it('asks for every blank field, numbered, and answers with what fills each', async () => {
    const answer = [
      '<fill n="1">"Wry and salt-stung"</fill>',
      '<fill n="9">Oswin\nTarrow</fill>',
      '<fill n="14">He sold her mother’s boat.</fill>',
      '<fill n="40">Nobody asked for this.</fill>',
      '<fill n="2"></fill>',
    ].join('\n');
    const proxy = await proxyWith([{ text: answer }]);
    const { app, cookie } = await setUp(catalogOf(proxy));
    const r = await send(app, 'POST', '/v1/suggestions/blanks', cookie, { setup: page(), bookId: null });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      fields: [
        { field: { kind: 'world', field: 'tone' }, text: 'Wry and salt-stung' },
        { field: { kind: 'character', id: NOBODY, field: 'name' }, text: 'Oswin Tarrow' },
        { field: { kind: 'side', id: MARA, other: IVEN, field: 'hides' }, text: 'He sold her mother’s boat.' },
      ],
    });

    const [asked] = proxy.asked;
    const { system, user } = promptOf(asked);
    expect(system.startsWith('You are Procreator.')).toBe(true);
    expect(system).toContain('<fill n="1">');
    expect(user.startsWith('<book>\nTitle: The Salt Queen')).toBe(true);
    expect(user).toContain('<blank n="1">\nWhere: The world: tone\nWhat it holds: The tone, in a few words (cosy, grim, funny).\nLength: a few words, on one line\n</blank>');
    expect(user).toContain("<blank n=\"9\">\nWhere: Unnamed 1's sheet: name");
    expect(user).toContain('<blank n="14">\nWhere: What Mara hides from Iven\nWhat it holds: Secrets, debts, what Mara would never say to Iven.\nLength: one to three sentences');
    expect(user).not.toContain('<blank n="17">');
    expect(user.endsWith('Answer with a fill for each, in order.')).toBe(true);
    expect(asked.body.generationConfig?.thinkingConfig?.thinkingLevel).toBe('LOW');
  });

  it('asks nothing when no field is blank', async () => {
    const proxy = await proxyWith([{ text: 'Nothing.' }]);
    const { app, cookie } = await setUp(catalogOf(proxy));
    const full = {
      ...page(),
      world: { genre: 'g', tone: 't', setting: 's', rules: 'r', notes: 'n' },
      protagonist: { id: MARA, name: 'Mara', who: 'w', personality: 'p', past: 'p', notes: 'n' },
      cast: [],
      relationships: [],
    };
    const r = await send(app, 'POST', '/v1/suggestions/blanks', cookie, { setup: full, bookId: null });
    expect(r.body).toEqual({ fields: [] });
    expect(proxy.asked).toHaveLength(0);
  });

  it('records the call as setup help, and says so when the model doesn’t answer', async () => {
    const proxy = await proxyWith([{ text: '<fill n="1">Wry</fill>' }, { status: 400 }]);
    const { app, cookie, userId } = await setUp(catalogOf(proxy));
    const bookId = await aBook(userId);
    await send(app, 'POST', '/v1/suggestions/blanks', cookie, { setup: page(), bookId });
    const mine = await lastCall(userId);
    expect(mine).toMatchObject({ role: 'setup', bookId, thinking: 'low' });
    const r = await send(app, 'POST', '/v1/suggestions/blanks', cookie, { setup: page(), bookId });
    expect(r.status).toBe(502);
    expect(r.body.code).toBe('ai_failed');
  });
});
