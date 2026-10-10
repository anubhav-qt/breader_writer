import { SCENE_WORDS } from '@writer/shared/book';
import type { Db, Tx } from '../db/client.ts';
import { render } from '../prompts/render.ts';
import { castOf, namesOf } from '../story/cast.ts';
import { readStory } from '../story/read.ts';
import { sceneNow, turnsOf, type Scene, type Turn } from '../story/scenes.ts';
import { briefView } from '../story/view.ts';

/*
 * What Procreator reads in a scene's session: its instructions, the head a segment opens with (the
 * brief, and after a compaction the scene so far), both built from the story as it stands, and
 * each turn as it's sent.
 */

/** Procreator's instructions for a book's sessions. */
export async function instructionsFor(db: Db | Tx, bookId: string): Promise<string> {
  const cast = await castOf(db, bookId);
  const protagonist = cast.find((character) => character.role === 'protagonist');
  const sceneWords = SCENE_WORDS.toLocaleString('en-US');
  return render('procreator/system.njk', { protagonist: protagonist?.name ?? 'the protagonist', sceneWords });
}

/** What a segment of the scene's session opens with: the brief, and the scene so far once there's one. */
export async function headFor(db: Db | Tx, scene: Scene, summary: string): Promise<string> {
  const story = await readStory(db, scene.bookId);
  const current = story.scenes.find((each) => each.id === scene.id) ?? scene;
  const before = story.scenes.find((each) => each.number === current.number - 1);
  // The whole scene before, word for word, so the story picks up in its voice and nothing it left open slips.
  let lastScene: Turn[] = [];
  if (before) {
    lastScene = await turnsOf(db, before.id);
  }
  const view = briefView(story, current, lastScene);
  return render('procreator/head.njk', { ...view, summary });
}

/** A turn as Procreator is sent it (prompts/templates/procreator/turn.njk). */
export async function turnMessage(db: Db | Tx, scene: Scene, turn: Turn): Promise<string> {
  const names = namesOf(await castOf(db, scene.bookId));
  let played = '';
  if (turn.played !== null) {
    played = names.get(turn.played) ?? '';
  }
  const current = await sceneNow(db, scene.id);
  const present: string[] = [];
  for (const id of current.present) {
    const name = names.get(id);
    if (name !== undefined) {
      present.push(name);
    }
  }
  const view = { number: current.number, place: current.place, time: current.time, present };
  return render('procreator/turn.njk', { voice: turn.voice, input: turn.input, played, scene: view });
}
