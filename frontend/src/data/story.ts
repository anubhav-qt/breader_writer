import { EditEvent, RewriteView, StoryView, type EditAsk } from '@writer/shared/story';
import { streamEvents, writer } from '../lib/api';

/*
 * The story mid play (step 6), for the Story panel: what it holds, the owner's changes to it, and
 * what a change that reached back rewrote. A change streams back, since one that reaches back has
 * Procreator rewrite what was played first, a part at a time.
 */

function storyPath(bookId: string, rest = ''): string {
  return `/v1/books/${bookId}/story${rest}`;
}

/** The story as the Story panel shows it. */
export async function fetchStory(bookId: string): Promise<StoryView> {
  const data = await writer.get<unknown>(storyPath(bookId));
  return StoryView.parse(data);
}

/** The owner changes the story: how far a rewrite has got, then the story, or why it wasn't changed. */
export function changeStory(bookId: string, ask: EditAsk, onEvent: (event: EditEvent) => void, signal: AbortSignal): Promise<void> {
  return streamEvents(storyPath(bookId, '/edits'), ask, (data) => onEvent(EditEvent.parse(data)), signal);
}

/** What a change that reached back rewrote, each passage before and after. */
export async function fetchRewrite(bookId: string, change: number): Promise<RewriteView> {
  const data = await writer.get<unknown>(storyPath(bookId, `/rewrites/${change}`));
  return RewriteView.parse(data);
}
