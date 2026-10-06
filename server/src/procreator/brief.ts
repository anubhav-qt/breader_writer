import type { Db, Tx } from '../db/client.ts';
import { render } from '../prompts/render.ts';
import { castOf } from '../story/cast.ts';
import { lastTurns, readStory } from '../story/read.ts';
import type { Scene, Turn } from '../story/scenes.ts';
import { briefView } from '../story/view.ts';

/*
 * What Procreator reads before anything else in a scene's session: its instructions, and the head
 * a segment opens with (the brief, and after a compaction the scene so far), both built from the
 * story as it stands.
 */

/** How many of the scene before's last turns the brief gives word for word, to pick the story up from. */
const CLOSING_TURNS = 3;

/** Procreator's instructions for a book's sessions. */
export async function instructionsFor(db: Db | Tx, bookId: string): Promise<string> {
  const cast = await castOf(db, bookId);
  const protagonist = cast.find((character) => character.role === 'protagonist');
  return render('procreator/system.njk', { protagonist: protagonist?.name ?? 'the protagonist' });
}

/** What a segment of the scene's session opens with: the brief, and the scene so far once there's one. */
export async function headFor(db: Db | Tx, scene: Scene, summary: string): Promise<string> {
  const story = await readStory(db, scene.bookId);
  const current = story.scenes.find((each) => each.id === scene.id) ?? scene;
  const before = story.scenes.find((each) => each.number === current.number - 1);
  let closing: Turn[] = [];
  if (before) {
    closing = await lastTurns(db, before.id, CLOSING_TURNS);
  }
  const view = briefView(story, current, closing);
  return render('procreator/head.njk', { ...view, summary });
}
