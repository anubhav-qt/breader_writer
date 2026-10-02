import { desc, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { ModelError } from '../src/ai/call.ts';
import { modelInUse } from '../src/ai/settings.ts';
import { calls, changes, scenes } from '../src/db/schema.ts';
import { startChange } from '../src/story/changes.ts';
import { budgetFor, fitBudget, foldPoint, foldScene, foldTurns, type Folding } from '../src/story/fold.ts';
import { readStory } from '../src/story/read.ts';
import { addTurn, endScene, setReply, type Scene, type Turn } from '../src/story/scenes.ts';
import { storyView } from '../src/story/view.ts';
import { deps } from './helpers.ts';
import { antigravity, catalogOf, fakeProxy, promptOf, type FakeProxy, type Reply, type Served } from './proxy.ts';
import { aPlayedStory, tag } from './stories.ts';

const db = deps.db;
const proxies: FakeProxy[] = [];

afterEach(async () => {
  for (const proxy of proxies.splice(0)) {
    await proxy.close();
  }
});

/** A fake proxy that answers with these replies, and folding through its default model. */
async function foldingWith(replies: Reply[], userId: string, served: Served = antigravity()) {
  const proxy = await fakeProxy({ ...served, replies });
  proxies.push(proxy);
  const catalog = catalogOf(proxy);
  const inUse = await modelInUse(catalog, null);
  if (!inUse) {
    throw new Error('The fake proxy serves no models.');
  }
  const ai: Folding = { db, catalog, inUse, userId };
  return { proxy, ai };
}

async function sceneNow(id: string): Promise<Scene> {
  const [scene] = await db.select().from(scenes).where(eq(scenes.id, id));
  return scene;
}

async function end(bookId: string, scene: Scene) {
  await db.transaction(async (tx) => {
    const change = await startChange(tx, tag(bookId));
    await endScene(tx, change, scene);
  });
}

describe('folding a scene', () => {
  it('folds an ended scene into its summary, as a change, and records the call', async () => {
    const story = await aPlayedStory();
    await end(story.bookId, story.second);
    const { proxy, ai } = await foldingWith([{ text: 'Aiko asked Ren who cut the rope. "Not me," he said, too quickly. The river rose.' }], story.userId);

    const folded = await foldScene(ai, story.second.id);
    expect(folded).toMatchObject({ foldedThrough: story.note.number, summary: 'Aiko asked Ren who cut the rope. "Not me," he said, too quickly. The river rose.' });

    const [change] = await db.select().from(changes).where(eq(changes.bookId, story.bookId)).orderBy(desc(changes.id)).limit(1);
    expect(change).toMatchObject({ by: 'agent', turnId: story.note.id, what: 'Folded turns 2 to 3 into scene 2\'s summary' });

    const [call] = await db.select().from(calls).where(eq(calls.bookId, story.bookId));
    expect(call).toMatchObject({
      userId: story.userId,
      sceneId: story.second.id,
      turnId: story.note.id,
      role: 'fold',
      model: 'gemini-3.8-flash-high',
      thinking: 'high',
      input: 1200,
      output: 80,
      stopReason: 'stop',
      error: null,
    });
    expect(call.estimate).toBeGreaterThan(200);
    expect(proxy.asked[0].body.generationConfig?.thinkingConfig?.thinkingLevel).toMatch(/high/i);

    const view = storyView(await readStory(db, story.bookId));
    expect(view.earlier[1]).toMatchObject({ number: 2, summary: folded.summary, turns: [] });
  });

  it('asks with the story first, the turns to fold, and the task last', async () => {
    const story = await aPlayedStory();
    await end(story.bookId, story.second);
    const { proxy, ai } = await foldingWith([{ text: 'They crossed.' }], story.userId);
    await foldScene(ai, story.second.id);

    const { system, user } = promptOf(proxy.asked[0]);
    expect(system).toContain('You keep the memory of a story that is being played');
    expect(system).toContain('The owner plays Aiko;');
    expect(user.startsWith('<book>\nTitle: The Lantern Road')).toBe(true);
    expect(user).toContain('<summary>\nAiko lit the first lamp, and Ren came to the door.\n</summary>');
    expect(user).toContain('<scene_to_fold>\n<scene number="2">\nWhere: The ferry\nWhen: Dusk\nPresent: Aiko, Ren\n<turn number="2">');
    expect(user).toContain('<author_note>Make the river rise.</author_note>');
    expect(user).not.toContain('I jump.');
    expect(user).not.toContain('<current_scene>');
    // Scene 2 is only in the part to fold, not among the earlier scenes too.
    expect(user.match(/<scene number="2">/g)).toHaveLength(1);
    expect(user).toContain('fold the turns in scene 2 into a summary of the scene.\nThese are the scene\'s last turns');
    expect(user.endsWith('start with what happened first.')).toBe(true);
  });

  it('folds the oldest turns of a scene being played, and the next fold builds on the summary so far', async () => {
    const story = await aPlayedStory();
    const { proxy, ai } = await foldingWith([{ text: 'Aiko asked Ren about the rope.' }, { text: 'Aiko asked; the river rose.' }], story.userId);

    const once = await foldTurns(ai, story.second.id, story.move.number);
    expect(once).toMatchObject({ foldedThrough: story.move.number, summary: 'Aiko asked Ren about the rope.', status: 'playing' });
    const first = promptOf(proxy.asked[0]).user;
    expect(first).toContain('I ask Ren who cut the rope.');
    expect(first).not.toContain('Make the river rise.');
    expect(first).toContain('The scene is still being played, so the summary stops where these turns stop.');

    const view = storyView(await readStory(db, story.bookId));
    expect(view.scene?.summary).toBe('Aiko asked Ren about the rope.');
    expect(view.scene?.turns.map((turn) => turn.number)).toEqual([story.note.number]);

    await foldTurns(ai, story.second.id, story.note.number);
    const second = promptOf(proxy.asked[1]).user;
    expect(second).toContain('<summary>\nAiko asked Ren about the rope.\n</summary>\n<turn number="3">');
    expect(second).toContain('into its summary, keeping everything the summary already says.');
    expect((await sceneNow(story.second.id)).summary).toBe('Aiko asked; the river rose.');
  });

  it('changes nothing when the model fails, runs out of room or writes nothing', async () => {
    const story = await aPlayedStory();
    await end(story.bookId, story.second);
    const replies = [{ status: 400 }, { text: 'Aiko asked Ren', finish: 'MAX_TOKENS' }, { text: '  ' }];
    const { ai } = await foldingWith(replies, story.userId);

    await expect(foldScene(ai, story.second.id)).rejects.toThrow(ModelError);
    await expect(foldScene(ai, story.second.id)).rejects.toThrow('The summary of scene 2 was cut off, so its turns stay as they were.');
    await expect(foldScene(ai, story.second.id)).rejects.toThrow('The model wrote no summary of scene 2');

    expect(await sceneNow(story.second.id)).toMatchObject({ summary: '', foldedThrough: 0 });
    const recorded = await db.select().from(calls).where(eq(calls.bookId, story.bookId));
    expect(recorded.map((call) => call.stopReason).sort()).toEqual(['error', 'length', 'stop']);
  });
});

/** Adds long turns to the scene being played: each about 500 tokens. */
async function longTurns(scene: Scene, count: number): Promise<Turn[]> {
  const made: Turn[] = [];
  for (let i = 0; i < count; i += 1) {
    const turn = await addTurn(db, scene, 'character', `Move ${i}. ${'I keep rowing. '.repeat(40)}`);
    made.push(await setReply(db, turn, `Reply ${i}. ${'The oars creak. '.repeat(90)}`));
  }
  return made;
}

/** What the proxy serves, with the default model's window this small. */
function smallWindow(contextLength: number): Served {
  const served = antigravity();
  const gemini = served.definitions.antigravity[0] as { context_length: number };
  gemini.context_length = contextLength;
  return served;
}

describe('the budget', () => {
  it('is 200k tokens at most, or half a smaller window', async () => {
    const { ai } = await foldingWith([], 'nobody');
    expect(budgetFor({ ...ai.inUse.model, contextWindow: 1_048_576 })).toBe(200_000);
    expect(budgetFor({ ...ai.inUse.model, contextWindow: 128_000 })).toBe(64_000);
  });

  it('folds just enough of the oldest turns, never the latest four', () => {
    const turns = [1, 2, 3, 4, 5, 6].map((number) => ({ number, input: 'x'.repeat(400), reply: 'y'.repeat(400) }) as Turn);
    expect(foldPoint(turns, 150)).toBe(1);
    expect(foldPoint(turns, 250)).toBe(2);
    expect(foldPoint(turns, 100_000)).toBe(2);
    expect(foldPoint(turns.slice(0, 4), 100)).toBeNull();
  });

  it('leaves a story that fits alone', async () => {
    const story = await aPlayedStory();
    const { proxy, ai } = await foldingWith([{ text: 'Never asked.' }], story.userId);
    const fit = await fitBudget(ai, story.bookId);
    expect(fit.folded).toBe(0);
    expect(fit.tokens).toBeLessThan(fit.budget);
    expect(proxy.asked).toHaveLength(0);
  });

  it('folds the oldest turns of the scene being played until the story fits, keeping the latest four', async () => {
    const story = await aPlayedStory();
    const added = await longTurns(story.second, 8);
    const { proxy, ai } = await foldingWith([{ text: 'Aiko rowed on while Ren kept quiet.' }], story.userId, smallWindow(6000));

    const fit = await fitBudget(ai, story.bookId);
    expect(fit.budget).toBe(3000);
    expect(fit.folded).toBeGreaterThan(0);
    expect(fit.tokens).toBeLessThanOrEqual(fit.budget);
    expect(proxy.asked).toHaveLength(1);

    const view = storyView(await readStory(db, story.bookId));
    const kept = view.scene?.turns.map((turn) => turn.number) ?? [];
    const latest = added.slice(-4).map((turn) => turn.number);
    expect(kept.slice(-4)).toEqual(latest);
    expect(view.scene?.summary).toBe('Aiko rowed on while Ren kept quiet.');
  });

  it('first folds a scene that ended without folding', async () => {
    const story = await aPlayedStory();
    await end(story.bookId, story.second);
    const { proxy, ai } = await foldingWith([{ text: 'They crossed.' }], story.userId);
    await fitBudget(ai, story.bookId);
    expect(proxy.asked).toHaveLength(1);
    expect((await sceneNow(story.second.id)).summary).toBe('They crossed.');
  });
});
