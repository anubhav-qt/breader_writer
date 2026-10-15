import { useEffect, useRef, useState } from 'react';
import type { EditEvent, Reach, StoryEdit, StoryView } from '@writer/shared/story';
import { changeStory, fetchStory } from '../../data/story';
import { failureText } from '../../lib/api';

/*
 * The story mid play as the play page holds it, for the Story and Notes panels and the sheets they
 * open: the story as the server last said, the sheet open over the page, and a change on its way.
 * The page holds it rather than a panel, so closing a panel doesn't stop a change, and the quiet
 * lines in the play's page can open a sheet too.
 */

/**
 * A sheet open over the page: someone's, someone new's, the line between two, what a rewrite
 * changed, a page of the reference, or a new page.
 */
export type Opened =
  | { kind: 'person'; id: string }
  | { kind: 'new' }
  | { kind: 'line'; a: string; b: string }
  | { kind: 'rewrite'; change: number }
  | { kind: 'page'; id: string }
  | { kind: 'newPage' };

/** A change on its way: once Procreator is rewriting what was played, how many parts are done. */
export interface Saving {
  done: number;
  of: number;
}

export function useStory(bookId: string, onChanged: () => void) {
  const [story, setStory] = useState<StoryView | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [saving, setSaving] = useState<Saving | null>(null);
  const [error, setError] = useState<string | null>(null);
  const work = useRef<AbortController | null>(null);
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;

  // Leaving the page stops a change on its way, and nothing of it is kept.
  useEffect(() => {
    return () => work.current?.abort();
  }, []);

  /** Reads the story again: as the panel opens, and after the play changed it. */
  const reload = async () => {
    try {
      setStory(await fetchStory(bookId));
    } catch (e) {
      setError(failureText(e));
    }
  };

  /** Makes the owner's change. Answers whether it was kept. */
  const edit = async (change: StoryEdit, reach: Reach): Promise<boolean> => {
    const controller = new AbortController();
    work.current = controller;
    setSaving({ done: 0, of: 0 });
    setError(null);
    let kept = false;
    const onEvent = (event: EditEvent) => {
      if (event.type === 'rewriting') {
        setSaving({ done: event.done, of: event.of });
        return;
      }
      setStory(event.story);
      if (event.type === 'done') {
        kept = true;
        return;
      }
      setError(event.message);
    };
    try {
      await changeStory(bookId, { edit: change, reach }, onEvent, controller.signal);
    } catch (e) {
      if (controller.signal.aborted) return false;
      setError(failureText(e));
    } finally {
      setSaving(null);
      if (work.current === controller) {
        work.current = null;
      }
    }
    // The play shows the change too: a new title, rewritten turns, the quiet line it left.
    changedRef.current();
    return kept;
  };

  const open = (sheet: Opened) => {
    setError(null);
    setOpened(sheet);
  };

  const close = () => {
    setOpened(null);
  };

  return { story, opened, saving, error, reload, edit, open, close, clearError: () => setError(null) };
}

export type StoryState = ReturnType<typeof useStory>;
