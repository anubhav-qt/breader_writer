import type { AssistantMessage, Message } from '@writer/pi-ai';
import { and, asc, desc, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { ModelError } from '../src/ai/call.ts';
import { modelInUse } from '../src/ai/settings.ts';
import { actorSegments, calls, changes, pages, scenes, sessionMessages, sessionSegments } from '../src/db/schema.ts';
import { cueActor } from '../src/procreator/actor.ts';
import { addNote, converse } from '../src/procreator/converse.ts';
import { compactAt, compactPrompt, cutPoint, FoldError, wrapUp, type Cut } from '../src/procreator/folds.ts';
import type { Procreator } from '../src/procreator/run.ts';
import { addActorMessage } from '../src/story/actors.ts';
import { StoryError } from '../src/story/changes.ts';
import { notesOf } from '../src/story/memory.ts';
import { findPage } from '../src/story/pages.ts';
import { addTurn, setReply, type Scene, type Turn } from '../src/story/scenes.ts';
import { addMessage, currentSegment, cutSession, type Numbered, type Segment } from '../src/story/session.ts';
import { deps } from './helpers.ts';
import { antigravity, catalogOf, fakeProxy, promptOf, textsOf, toolsOf, type FakeProxy, type Marked, type Reply, type Served } from './proxy.ts';
import { aScene, end, nextScene } from './stories.ts';

const db = deps.db;
const proxies: FakeProxy[] = [];

afterEach(async () => {
  for (const proxy of proxies.splice(0)) {
    await proxy.close();
  }
});

/** Procreator on a fake proxy that answers with these replies, through its default model. */
async function procreatorWith(replies: Reply[], userId: string, served: Served = antigravity()) {
  const proxy = await fakeProxy({ ...served, replies });
  proxies.push(proxy);
  const catalog = catalogOf(proxy);
  const inUse = await modelInUse(catalog, null);
  if (!inUse) {
    throw new Error('The fake proxy serves no models.');
  }
  const ai: Procreator = { db, catalog, inUse, userId };
  return { proxy, ai };
}

/** Procreator as procreatorWith makes it, on another model the proxy serves. */
async function procreatorOn(model: string, replies: Reply[], userId: string, served: Served = antigravity()) {
  const { proxy, ai } = await procreatorWith(replies, userId, served);
  const inUse = await modelInUse(ai.catalog, { model, thinking: 'high' });
  if (inUse?.model.id !== model) {
    throw new Error(`The fake proxy doesn’t serve ${model}.`);
  }
  const on: Procreator = { ...ai, inUse };
  return { proxy, ai: on };
}

/** What the proxy serves, with the default model's window and longest answer this small. */
function smallWindow(window: number, answer: number): Served {
  const served = antigravity();
  const gemini = served.definitions.antigravity[0] as { context_length: number; max_completion_tokens: number };
  gemini.context_length = window;
  gemini.max_completion_tokens = answer;
  return served;
}

/** The owner's move as a turn, and Procreator's answer to it. */
async function play(ai: Procreator, scene: Scene, move: string) {
  const turn = await addTurn(db, scene, 'character', move);
  const answer = await converse(ai, scene, move, turn.id);
  return { turn, answer };
}

async function messagesOf(scene: Scene) {
  return db.select().from(sessionMessages).where(eq(sessionMessages.sceneId, scene.id)).orderBy(asc(sessionMessages.seq));
}

async function segmentsOf(scene: Scene): Promise<Segment[]> {
  return db.select().from(sessionSegments).where(eq(sessionSegments.sceneId, scene.id)).orderBy(asc(sessionSegments.number));
}

async function sceneNow(scene: Scene): Promise<Scene> {
  const [now] = await db.select().from(scenes).where(eq(scenes.id, scene.id));
  return now;
}

const TOOLS = [
  'read_page',
  'write_page',
  'edit_page',
  'search',
  'remember',
  'forget',
  'shift_relationship',
  'set_scene',
  'join_cast',
  'cue',
  'send_back',
  'end_scene',
  'end_story',
  'offer_openings',
  'offer_moves',
];

describe('a scene’s session', () => {
  it('opens with the brief, and keeps every message and call as it comes back', async () => {
    const { userId, scene } = await aScene();
    const { proxy, ai } = await procreatorWith([{ text: 'Ren waves back.' }], userId);
    const { turn, answer } = await play(ai, scene, 'I wave at Ren.');
    expect(answer).toMatchObject({ text: 'Ren waves back.', words: 'Ren waves back.', stopReason: 'stop' });

    const [asked] = proxy.asked;
    expect(promptOf(asked).system.startsWith('You are Procreator.')).toBe(true);
    expect(toolsOf(asked)).toEqual(TOOLS);
    const [head, move] = textsOf(asked);
    expect(head.startsWith('<book>\nTitle: The Lantern Road')).toBe(true);
    expect(head).toContain('<this_scene number="1">');
    expect(move).toBe('I wave at Ren.');

    const [segment] = await segmentsOf(scene);
    expect(segment).toMatchObject({ number: 1, head, summary: '', fromSeq: 1, turnId: null, undone: false });
    const kept = await messagesOf(scene);
    expect(kept.map((row) => [row.seq, row.kind, (row.message as Message).role, row.turnId])).toEqual([
      [1, 'play', 'user', turn.id],
      [2, 'play', 'assistant', turn.id],
    ]);
    const [call] = await db.select().from(calls).where(eq(calls.sceneId, scene.id));
    expect(call).toMatchObject({ userId, role: 'narrator', turnId: turn.id, model: 'gemini-3.8-flash-high', input: 1200, output: 80, cacheRead: 0, stopReason: 'stop' });
    expect(call.estimate).toBeGreaterThan(500);
  });

  it('sends each call with all the one before sent and got, so only the end grows and the cache holds', async () => {
    const { userId, scene } = await aScene();
    const replies = [{ text: 'Ren waves back.', signature: 'c2lnbmF0dXJl' }, { text: 'Ren laughs.', read: 2400, cached: 2000 }];
    const { proxy, ai } = await procreatorWith(replies, userId);
    await play(ai, scene, 'I wave at Ren.');
    await play(ai, scene, 'I splash him.');

    const [first, second] = proxy.asked;
    expect(second.body.contents.slice(0, first.body.contents.length)).toEqual(first.body.contents);
    expect(second.body.systemInstruction).toEqual(first.body.systemInstruction);
    expect(second.body.tools).toEqual(first.body.tools);
    // Procreator's own answer goes back as it came, its thought signature with it.
    expect(second.body.contents[2]).toEqual({ role: 'model', parts: [{ text: 'Ren waves back.', thoughtSignature: 'c2lnbmF0dXJl' }] });
    expect(textsOf(second).at(-1)).toBe('I splash him.');

    const recorded = await db.select().from(calls).where(eq(calls.sceneId, scene.id)).orderBy(asc(calls.startedAt));
    expect(recorded.map((call) => call.cacheRead)).toEqual([0, 2000]);
    expect(recorded[1].input).toBe(400);
  });

  it('asks Claude to keep the session cached for an hour, up to the newest message', async () => {
    const { userId, scene } = await aScene();
    const { proxy, ai } = await procreatorOn('claude-sonnet-4-6', [{ text: 'Ren waves back.' }], userId);
    const { answer } = await play(ai, scene, 'I wave at Ren.');
    expect(answer.text).toBe('Ren waves back.');

    const [asked] = proxy.askedClaude;
    const hour = { type: 'ephemeral', ttl: '1h' };
    expect(asked.system?.at(-1)?.cache_control).toEqual(hour);
    expect(asked.tools?.at(-1)?.cache_control).toEqual(hour);
    const newest = asked.messages.at(-1)?.content as Marked[];
    expect(newest.at(-1)).toMatchObject({ text: 'I wave at Ren.', cache_control: hour });
  });

  it('keys OpenAI’s cache by the scene, and asks it to last', async () => {
    const { userId, scene } = await aScene();
    const served = antigravity();
    served.models.push({ id: 'gpt-5.5', owned_by: 'codex' });
    const { proxy, ai } = await procreatorOn('gpt-5.5', [{ text: 'Ren waves back.' }], userId, served);
    const { answer } = await play(ai, scene, 'I wave at Ren.');
    expect(answer.text).toBe('Ren waves back.');

    const [asked] = proxy.askedOpenAI;
    expect(asked.prompt_cache_key).toBe(scene.id);
    // The real proxy drops this on its way to Codex, whose backend keeps the cache its own way.
    expect(asked.prompt_cache_retention).toBe('24h');
  });

  it('runs the tools Procreator calls, each a change at its turn, and sends their results back', async () => {
    const { userId, bookId, ren, scene } = await aScene();
    const replies: Reply[] = [
      {
        calls: [
          { name: 'write_page', args: { title: 'The Ferry', kind: 'place', about: 'The boat across.', body: '[[Ren]] poles it across.' } },
          { name: 'remember', args: { note: 'The owner likes [[Ren]].' } },
        ],
      },
      { text: 'The ferry rocks.' },
    ];
    const { proxy, ai } = await procreatorWith(replies, userId);
    const { turn, answer } = await play(ai, scene, 'I step aboard.');
    expect(answer.text).toBe('The ferry rocks.');
    expect(proxy.asked).toHaveLength(2);

    const sent = JSON.stringify(proxy.asked[1].body.contents.slice(-2));
    expect(sent).toContain('Made the page The Ferry.');
    expect(sent).toMatch(/Remembered as note \d+\./);

    const found = await findPage(db, bookId, 'The Ferry');
    expect(found.page?.body).toBe(`<@${ren.id}> poles it across.`);
    expect((await notesOf(db, bookId)).map((note) => note.text)).toEqual([`The owner likes <@${ren.id}>.`]);
    const made = await db.select().from(changes).where(eq(changes.turnId, turn.id)).orderBy(asc(changes.id));
    expect(made.map((change) => [change.what, change.by])).toEqual([
      ['Wrote the page The Ferry', 'agent'],
      ['Remembered a note', 'agent'],
    ]);
    const kept = await messagesOf(scene);
    expect(kept.map((row) => (row.message as Message).role)).toEqual(['user', 'assistant', 'toolResult', 'toolResult', 'assistant']);
    expect(new Set(kept.map((row) => row.kind))).toEqual(new Set(['play']));
  });

  it('turns a call down with how to put it right, and Procreator carries on', async () => {
    const { userId, bookId, scene } = await aScene();
    const replies: Reply[] = [
      {
        calls: [
          { name: 'write_page', args: { title: 'Tobin', kind: 'character', about: '', body: 'A stranger.' } },
          { name: 'read_page', args: {} },
        ],
      },
      { text: 'A stranger watches.' },
    ];
    const { proxy, ai } = await procreatorWith(replies, userId);
    const { answer } = await play(ai, scene, 'Who is that?');
    expect(answer.text).toBe('A stranger watches.');
    const sent = JSON.stringify(proxy.asked[1].body.contents.slice(-1));
    expect(sent).toContain('No one in the cast is called Tobin.');
    expect(sent).toContain('read_page');
    const results = (await messagesOf(scene)).map((row) => row.message as Message).filter((message) => message.role === 'toolResult');
    expect(results.map((result) => result.isError)).toEqual([true, true]);
    expect(await db.select().from(pages).where(eq(pages.bookId, bookId))).toEqual([]);
  });

  it('tells Procreator of the owner’s change with the next message', async () => {
    const { userId, scene } = await aScene();
    const { proxy, ai } = await procreatorWith([{ text: 'Ren waves back.' }, { text: 'Ren limps closer.' }], userId);
    const { turn } = await play(ai, scene, 'I wave at Ren.');
    await addNote(db, scene, turn.id, 'The owner changed Ren: from now on, he limps.');
    await play(ai, scene, 'I call him over.');
    const texts = textsOf(proxy.asked[1]);
    expect(texts.slice(-2)).toEqual(['The owner changed Ren: from now on, he limps.', 'I call him over.']);
  });

  it('cuts the session back with an undo, and sends it without the turns taken back', async () => {
    const { userId, scene } = await aScene();
    const replies = [{ text: 'Ren waves back.' }, { text: 'You hit the water.' }, { text: 'Ren grins.' }];
    const { proxy, ai } = await procreatorWith(replies, userId);
    await play(ai, scene, 'I wave at Ren.');
    const jumped = await play(ai, scene, 'I jump in.');
    await cutSession(db, scene.id, jumped.turn.number);
    await play(ai, scene, 'I stay aboard.');

    const texts = textsOf(proxy.asked[2]);
    expect(texts.slice(1)).toEqual(['I wave at Ren.', 'Ren waves back.', 'I stay aboard.']);
    const kept = await messagesOf(scene);
    expect(kept).toHaveLength(6);
    expect(kept.filter((row) => row.undone).map((row) => row.turnId)).toEqual([jumped.turn.id, jumped.turn.id]);
  });

  it('takes no turns once the scene has ended', async () => {
    const { userId, bookId, scene } = await aScene();
    const { ai } = await procreatorWith([{ text: 'Never asked.' }], userId);
    const ended = await end(bookId, scene);
    await expect(converse(ai, ended, 'I wave.', null)).rejects.toThrow(StoryError);
  });

  it('fails when the model doesn’t answer, keeping what was sent and the call', async () => {
    const { userId, scene } = await aScene();
    const { ai } = await procreatorWith([{ status: 400 }], userId);
    await expect(play(ai, scene, 'I wave.')).rejects.toThrow(ModelError);
    const kept = await messagesOf(scene);
    expect(kept.map((row) => (row.message as Message).role)).toEqual(['user', 'assistant']);
    const [call] = await db.select().from(calls).where(eq(calls.sceneId, scene.id));
    expect(call.stopReason).toBe('error');
  });
});

/** Messages as a segment gives them: turn numbers, and text this many tokens long. */
function numbered(turns: { turn: number | null; tokens: number }[]): Numbered[] {
  return turns.map((each, index) => {
    const message: Message = { role: 'user', content: 'x'.repeat(each.tokens * 4), timestamp: 0 };
    const row = { seq: index + 1 } as Numbered['row'];
    return { row, message, turn: each.turn };
  });
}

function turnsOfCut(cut: Cut | null): { folded: (number | null)[]; kept: (number | null)[] } | null {
  if (!cut) {
    return null;
  }
  return { folded: cut.folded.map((run) => run.turn), kept: cut.kept.map((run) => run.turn) };
}

describe('compaction', () => {
  it('starts at 400k, or sooner when the window can’t fit that and an answer', async () => {
    const { ai } = await procreatorWith([], 'nobody');
    const model = ai.inUse.model;
    expect(compactAt({ ...model, contextWindow: 1_048_576, maxTokens: 65_536 })).toBe(400_000);
    expect(compactAt({ ...model, contextWindow: 200_000, maxTokens: 64_000 })).toBe(136_000);
    expect(compactAt({ ...model, contextWindow: 24_000, maxTokens: 4_000 })).toBe(20_000);
    expect(compactAt({ ...model, contextWindow: 8_000, maxTokens: 8_000 })).toBe(4_000);
  });

  it('cuts only between turns, keeping the newest that fit and always the latest', () => {
    const messages = numbered([
      { turn: 1, tokens: 100 },
      { turn: 1, tokens: 100 },
      { turn: 2, tokens: 300 },
      { turn: 3, tokens: 200 },
      { turn: null, tokens: 50 },
      { turn: 4, tokens: 900 },
    ]);
    expect(turnsOfCut(cutPoint(messages, 1200))).toEqual({ folded: [1, 2], kept: [3, 4] });
    expect(cutPoint(messages, 1200)?.fromSeq).toBe(4);
    expect(turnsOfCut(cutPoint(messages, 100))).toEqual({ folded: [1, 2, 3], kept: [4] });
    // However much fits, the oldest turn folds.
    expect(turnsOfCut(cutPoint(messages, 100_000))).toEqual({ folded: [1], kept: [2, 3, 4] });
    expect(cutPoint(numbered([{ turn: 1, tokens: 10 }, { turn: 1, tokens: 10 }]), 100)).toBeNull();
  });

  it('names the turns that fold and the first kept, and whether there’s a scene so far to keep', () => {
    const cut = cutPoint(numbered([{ turn: 4, tokens: 900 }, { turn: 5, tokens: 900 }, { turn: 6, tokens: 900 }]), 1000) as Cut;
    const scene = { number: 2 } as Scene;
    expect(compactPrompt(scene, { summary: '' } as Segment, cut)).toEqual({ scene: 2, from: 4, to: 5, keptFrom: 6, earlier: false });
    expect(compactPrompt(scene, { summary: 'They rowed.' } as Segment, cut)?.earlier).toBe(true);
  });

  /** A turn played without the model, kept in the session as if Procreator had answered: about 2,500 tokens. */
  async function playedTurn(scene: Scene, n: number): Promise<Turn> {
    const move = `Move ${n}. ${'I keep rowing. '.repeat(133)}`;
    const reply = `Reply ${n}. ${'The oars creak in the dark water. '.repeat(235)}`;
    const turn = await addTurn(db, scene, 'character', move);
    await setReply(db, turn, reply);
    await addMessage(db, scene, 'play', turn.id, { role: 'user', content: move, timestamp: Date.now() });
    const answer: AssistantMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: reply }],
      api: 'google-generative-ai',
      provider: 'antigravity',
      model: 'gemini-3.8-flash-high',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop',
      timestamp: Date.now(),
    };
    await addMessage(db, scene, 'play', turn.id, answer);
    return turn;
  }

  /** A scene whose session has grown past a 20k limit: a real first turn, then ten long ones. */
  async function aLongScene(replies: Reply[]) {
    const story = await aScene();
    const { proxy, ai } = await procreatorWith([{ text: 'Ren pushes off.' }, ...replies], story.userId, smallWindow(24_000, 4_000));
    await play(ai, story.scene, 'I take the oars.');
    const played: Turn[] = [];
    for (let n = 2; n <= 11; n += 1) {
      played.push(await playedTurn(story.scene, n));
    }
    return { ...story, proxy, ai, played };
  }

  it('saves first, then folds the older turns into the scene so far, and goes on from a fresh brief', async () => {
    const replies: Reply[] = [
      { calls: [{ name: 'edit_page', args: { title: 'Aiko', find: '', replace: 'Rows badly, and knows it.' } }] },
      { text: 'Aiko took the oars and rowed for hours while Ren kept quiet.' },
      { text: 'The far bank comes out of the fog.' },
    ];
    const { bookId, scene, proxy, ai, played } = await aLongScene(replies);
    const { turn, answer } = await play(ai, scene, 'I keep going.');
    expect(answer.text).toBe('The far bank comes out of the fog.');
    expect(proxy.asked).toHaveLength(4);

    const request = promptOf(proxy.asked[1]).user;
    expect(request).toContain('turns 1 to 10 of scene 1 are about to leave your context');
    expect(request).toContain('turn 11 onward word for word');
    expect((await findPage(db, bookId, 'Aiko')).page?.body).toBe('Rows badly, and knows it.');

    const segments = await segmentsOf(scene);
    expect(segments).toHaveLength(2);
    const kept = await messagesOf(scene);
    const firstKept = kept.find((row) => row.turnId === played[played.length - 1].id);
    expect(segments[1]).toMatchObject({
      number: 2,
      summary: 'Aiko took the oars and rowed for hours while Ren kept quiet.',
      fromSeq: firstKept?.seq,
      turnId: turn.id,
    });
    expect(segments[1].head).toContain('<scene_so_far>\nAiko took the oars and rowed for hours while Ren kept quiet.\n</scene_so_far>');
    expect(segments[1].head).toContain('Rows badly, and knows it.');

    const after = textsOf(proxy.asked[3]);
    expect(after[0]).toBe(segments[1].head);
    expect(after.slice(1, 3).map((text) => text.slice(0, 8))).toEqual(['Move 11.', 'Reply 11']);
    expect(after.at(-1)).toBe('I keep going.');
    expect(after.join('\n')).not.toContain('Move 10.');
    expect(after.join('\n')).not.toContain('<compaction>');

    expect(kept.filter((row) => row.kind === 'fold').length).toBe(4);
    expect(kept.filter((row) => row.undone)).toEqual([]);
    const roles = await db.select({ role: calls.role }).from(calls).where(eq(calls.sceneId, scene.id)).orderBy(asc(calls.startedAt));
    expect(roles.map((row) => row.role)).toEqual(['narrator', 'fold', 'fold', 'narrator']);
  });

  it('goes on uncompacted when the fold can’t be kept, and changes nothing', async () => {
    const { scene, proxy, ai } = await aLongScene([{ text: '   ' }, { text: 'The far bank.' }]);
    const { answer } = await play(ai, scene, 'I keep going.');
    expect(answer.text).toBe('The far bank.');
    expect(await segmentsOf(scene)).toHaveLength(1);
    const after = textsOf(proxy.asked[2]);
    expect(after.join('\n')).toContain('Move 2.');
    expect(after.join('\n')).not.toContain('<compaction>');
  });

  it('goes back to the segment before when an undo cuts the turn it was made at', async () => {
    const replies: Reply[] = [{ text: 'They rowed.' }, { text: 'The far bank.' }, { text: 'Ren rows instead.' }];
    const { scene, ai } = await aLongScene(replies);
    const { turn } = await play(ai, scene, 'I keep going.');
    expect(await segmentsOf(scene)).toHaveLength(2);
    await cutSession(db, scene.id, turn.number);
    expect((await currentSegment(db, scene.id))?.number).toBe(1);
  });
});

describe('the wrap-up', () => {
  it('saves what the scene established, then writes its summary, kept as a change', async () => {
    const { userId, bookId, scene } = await aScene();
    const replies: Reply[] = [
      { text: 'Ren waves back.' },
      { calls: [{ name: 'write_page', args: { title: 'Threads', kind: 'story', about: 'What is set up.', body: '- Why did [[Ren]] wave?' } }] },
      { text: 'Aiko waved to Ren from the ferry, and he waved back.' },
    ];
    const { proxy, ai } = await procreatorWith(replies, userId);
    const { turn } = await play(ai, scene, 'I wave at Ren.');
    const wrapped = await wrapUp(ai, await end(bookId, scene));

    expect(wrapped.summary).toBe('Aiko waved to Ren from the ferry, and he waved back.');
    const request = promptOf(proxy.asked[1]).user;
    expect(request.startsWith('<wrap_up>\nScene 1 has ended.')).toBe(true);
    expect(textsOf(proxy.asked[1])).toContain('I wave at Ren.');
    expect((await findPage(db, bookId, 'Threads')).page).not.toBeNull();
    const [latest] = await db.select().from(changes).where(eq(changes.bookId, bookId)).orderBy(desc(changes.id)).limit(1);
    expect(latest).toMatchObject({ what: 'Wrapped up scene 1', turnId: turn.id, by: 'agent' });
    const folds = await db
      .select()
      .from(sessionMessages)
      .where(and(eq(sessionMessages.sceneId, scene.id), eq(sessionMessages.kind, 'fold')));
    expect(folds).toHaveLength(4);
  });

  it('won’t wrap up a scene still playing, and leaves one wrapped up as it is', async () => {
    const { userId, bookId, scene } = await aScene();
    const { proxy, ai } = await procreatorWith([{ text: 'Ren waves back.' }, { text: 'Aiko waved.' }], userId);
    await expect(wrapUp(ai, scene)).rejects.toThrow('Scene 1 is still playing.');
    await play(ai, scene, 'I wave at Ren.');
    const wrapped = await wrapUp(ai, await end(bookId, scene));
    const asked = proxy.asked.length;
    expect(await wrapUp(ai, wrapped)).toEqual(wrapped);
    expect(proxy.asked).toHaveLength(asked);
  });

  it('changes nothing when the summary is cut off', async () => {
    const { userId, bookId, scene } = await aScene();
    const { ai } = await procreatorWith([{ text: 'Ren waves back.' }, { text: 'Aiko waved', finish: 'MAX_TOKENS' }], userId);
    await play(ai, scene, 'I wave at Ren.');
    await expect(wrapUp(ai, await end(bookId, scene))).rejects.toThrow(FoldError);
    expect((await sceneNow(scene)).summary).toBe('');
  });

  it('wraps up the scenes before a new session opens, so its brief holds them', async () => {
    const { userId, bookId, aiko, scene } = await aScene();
    const replies = [{ text: 'Ren waves back.' }, { text: 'Aiko waved, and Ren waved back.' }, { text: 'The far bank is quiet.' }];
    const { proxy, ai } = await procreatorWith(replies, userId);
    await play(ai, scene, 'I wave at Ren.');
    await end(bookId, scene);
    const second = await nextScene(bookId, 'The far bank', [aiko.id]);
    await play(ai, second, 'I step off.');

    expect(promptOf(proxy.asked[1]).user.startsWith('<wrap_up>')).toBe(true);
    const [head] = textsOf(proxy.asked[2]);
    expect(head).toContain('<scene number="1" where="The ferry" when="Dusk">\nAiko waved, and Ren waved back.\n</scene>');
    expect(head).toContain('<last_scene number="1">\n<turn number="1">\n<move by="Aiko">I wave at Ren.</move>');
    expect((await sceneNow(scene)).summary).toBe('Aiko waved, and Ren waved back.');
  });
});

describe('an actor’s compaction', () => {
  /**
   * Ren's actor answered a cue in scene 1, and his chat has grown past a 20k limit there. Scene 1
   * has ended (wrapped up, or not yet), and scene 2 is playing, a turn in.
   */
  async function aLongChat(replies: Reply[], wrapped: boolean) {
    const story = await aScene();
    const { proxy, ai } = await procreatorWith([{ text: 'I take the oars.' }, ...replies], story.userId, smallWindow(24_000, 4_000));
    const ren = { id: story.ren.id, name: 'Ren' };
    const first = await addTurn(db, story.scene, 'character', 'I ask Ren to row.');
    await cueActor(ai, { person: ren, scene: story.scene, turnId: first.id }, 'Aiko asks you to row.');
    const actor = { bookId: story.bookId, characterId: ren.id };
    for (let n = 1; n <= 10; n += 1) {
      const message: Message = { role: 'user', content: `Cue ${n}. ${'The river runs on. '.repeat(500)}`, timestamp: Date.now() };
      await addActorMessage(db, actor, { kind: 'play', turnId: first.id, sceneId: story.scene.id, message, self: null });
    }
    await end(story.bookId, story.scene);
    if (wrapped) {
      await db.update(scenes).set({ summary: 'Ren rowed Aiko across.' }).where(eq(scenes.id, story.scene.id));
    }
    const second = await nextScene(story.bookId, 'The far bank', [story.aiko.id, ren.id]);
    const turn = await addTurn(db, second, 'character', 'I wave at Ren.');
    const moment = { person: ren, scene: second, turnId: turn.id };
    return { ...story, proxy, ai, moment };
  }

  async function actorSegmentsOf(bookId: string) {
    return db.select().from(actorSegments).where(eq(actorSegments.bookId, bookId)).orderBy(asc(actorSegments.number));
  }

  it('folds the scenes wrapped up into what they remember, and goes on from a fresh start', async () => {
    const remembered = 'I rowed Aiko across, and said little.';
    const { bookId, proxy, ai, moment } = await aLongChat([{ text: remembered }, { text: 'I wave back.' }], true);
    expect(await cueActor(ai, moment, 'Aiko waves from the bank.')).toBe('I wave back.');
    expect(proxy.asked).toHaveLength(3);

    const ask = promptOf(proxy.asked[1]).user;
    expect(ask.startsWith('<remember>')).toBe(true);
    expect(ask).toContain('Write what Ren remembers of everything before Scene 2');
    expect(textsOf(proxy.asked[1]).join('\n')).toContain('Cue 10.');

    const segments = await actorSegmentsOf(bookId);
    expect(segments).toHaveLength(2);
    // Two messages of the first cue and ten more: everything folds, and the chat goes on after them.
    expect(segments[1]).toMatchObject({ number: 2, memory: remembered, fromSeq: 13, turnId: moment.turnId });
    const after = textsOf(proxy.asked[2]);
    expect(after).toHaveLength(2);
    expect(after[0]).toBe(segments[1].head);
    expect(after[0]).toContain('<what_you_remember>');
    expect(after[0]).toContain(remembered);
    expect(after[1]).toContain('<scene number="2" where="The far bank"');
    expect(after.join('\n')).not.toContain('Cue 10.');
    const roles = await db.select({ role: calls.role }).from(calls).where(eq(calls.bookId, bookId)).orderBy(asc(calls.startedAt));
    expect(roles.map((row) => row.role)).toEqual(['actor', 'fold', 'actor']);
  });

  it('folds nothing that isn’t wrapped up yet, and goes on as it was', async () => {
    const { bookId, proxy, ai, moment } = await aLongChat([{ text: 'I wave back.' }], false);
    expect(await cueActor(ai, moment, 'Aiko waves from the bank.')).toBe('I wave back.');
    expect(proxy.asked).toHaveLength(2);
    expect(textsOf(proxy.asked[1]).join('\n')).toContain('Cue 10.');
    expect(await actorSegmentsOf(bookId)).toHaveLength(1);
  });

  it('goes on as it was when the fold fails', async () => {
    const { bookId, proxy, ai, moment } = await aLongChat([{ status: 400 }, { text: 'I wave back.' }], true);
    expect(await cueActor(ai, moment, 'Aiko waves from the bank.')).toBe('I wave back.');
    expect(proxy.asked).toHaveLength(3);
    expect(textsOf(proxy.asked[2]).join('\n')).toContain('Cue 10.');
    expect(await actorSegmentsOf(bookId)).toHaveLength(1);
  });
});
