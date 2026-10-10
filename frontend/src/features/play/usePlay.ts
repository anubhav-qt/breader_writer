import { useEffect, useRef, useState } from 'react';
import type { MoveVoice, Person, Play, PlayEvent, SceneHead, Undone, Voice } from '@writer/shared/play';
import {
  another,
  askHints,
  askOpenings,
  fetchPlay,
  goOn,
  letActorPlay,
  openStory,
  readPlayOthers,
  sendMove,
  undoTurn,
  writePlayOthers,
} from '../../data/play';
import { failureText } from '../../lib/api';

/*
 * The play as the page holds it: the play as the server last said, and while Procreator writes,
 * what was sent and its words so far. A move that fails is taken back on the server, so the page
 * shows the play it answers with and the owner's words go back in the box.
 */

/** A move on its way, and Procreator's words for it so far. */
export interface Pending {
  voice: Voice;
  /** Who the owner (or an actor) plays in it. */
  played: Person | null;
  /** The owner's words, shown as they will be on the page. */
  input: string;
  /** The scene the words go into, once it's known. */
  scene: SceneHead | null;
  /** Going on to the next scene: the page starts fresh under its heading. */
  fresh: boolean;
  /** The scene before, while it's being finished for the book. */
  finishing: number | null;
  reply: string;
  /** Another reply: the turn being written again, which the page leaves out meanwhile. */
  redoing: string | null;
}

/** What the page is waiting for that isn't a move: the openings, hints, or an undo. */
type Asking = 'openings' | 'hints' | 'undo' | null;

/** The play as it loads, or why it didn't. */
type Loaded = { state: 'loading' } | { state: 'failed'; message: string } | { state: 'ready' };

type Call = (onEvent: (event: PlayEvent) => void, signal: AbortSignal) => Promise<void>;

/** The last of a list, or undefined when it's empty. */
export function newestOf<T>(list: T[]): T | undefined {
  if (list.length === 0) {
    return undefined;
  }
  return list[list.length - 1];
}

function blankPending(voice: Voice, played: Person | null, input: string, scene: SceneHead | null): Pending {
  return { voice, played, input, scene, fresh: false, finishing: null, reply: '', redoing: null };
}

export function usePlay(bookId: string) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [play, setPlay] = useState<Play | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [asking, setAsking] = useState<Asking>(null);
  const [hints, setHints] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playOthers, setPlayOthers] = useState(() => readPlayOthers(bookId));
  const work = useRef<AbortController | null>(null);
  // The openings are asked for once by themselves; after a failure, the owner asks again.
  const openingsAsked = useRef(false);

  useEffect(() => {
    let live = true;
    fetchPlay(bookId)
      .then((found) => {
        if (!live) return;
        setPlay(found);
        setLoaded({ state: 'ready' });
      })
      .catch((e) => {
        if (!live) return;
        setLoaded({ state: 'failed', message: failureText(e) });
      });
    return () => {
      live = false;
    };
  }, [bookId]);

  useEffect(() => {
    return () => work.current?.abort();
  }, []);

  /** Reads the play again, after something went wrong part way. */
  const refresh = async () => {
    try {
      setPlay(await fetchPlay(bookId));
    } catch {
      // What's shown stays; the error already says something went wrong.
    }
  };

  /** A controller for the work about to start, which leaving the page stops. */
  const startWork = (): AbortController => {
    const controller = new AbortController();
    work.current = controller;
    return controller;
  };

  const endWork = (controller: AbortController) => {
    if (work.current === controller) {
      work.current = null;
    }
  };

  const askForOpenings = async () => {
    openingsAsked.current = true;
    const controller = startWork();
    setAsking('openings');
    setError(null);
    try {
      setPlay(await askOpenings(bookId, controller.signal));
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(failureText(e));
      await refresh();
    } finally {
      setAsking(null);
      endWork(controller);
    }
  };

  // A story that hasn't started asks for its openings as the page opens.
  const stage = play?.stage;
  useEffect(() => {
    if (stage === 'start' && !openingsAsked.current) {
      void askForOpenings();
    }
    // askForOpenings is made anew each render; the stage is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  /**
   * Sends something Procreator writes from, showing it at once and its words as they come.
   * Answers whether the reply landed; if not, the move was taken back.
   */
  const run = async (start: Pending, call: Call): Promise<boolean> => {
    const controller = startWork();
    setPending(start);
    setError(null);
    setHints(null);
    let landed = false;
    const onEvent = (event: PlayEvent) => {
      if (event.type === 'scene') {
        setPending((now) => {
          if (!now) return now;
          return { ...now, scene: event.scene };
        });
        return;
      }
      if (event.type === 'finishing') {
        setPending((now) => {
          if (!now) return now;
          return { ...now, finishing: event.scene };
        });
        return;
      }
      if (event.type === 'text') {
        setPending((now) => {
          if (!now) return now;
          return { ...now, reply: now.reply + event.delta };
        });
        return;
      }
      setPlay(event.play);
      if (event.type === 'done') {
        landed = true;
        return;
      }
      setError(event.message);
    };
    try {
      await call(onEvent, controller.signal);
    } catch (e) {
      if (controller.signal.aborted) return false;
      setError(failureText(e));
      await refresh();
    } finally {
      setPending(null);
      endWork(controller);
    }
    return landed;
  };

  /** The owner's move as someone (the protagonist unless said), or a note as the author. */
  const move = (voice: MoveVoice, text: string, as: Person | null): Promise<boolean> => {
    if (!play) return Promise.resolve(false);
    let played: Person | null = null;
    if (voice === 'character' && as) {
      played = as;
    } else if (voice === 'character') {
      played = play.protagonist;
    }
    const ask = { voice, text, as: as?.id, playOthers };
    const start = blankPending(voice, played, text, play.scene);
    return run(start, (onEvent, signal) => sendMove(bookId, ask, onEvent, signal));
  };

  /** Opens the story with one of the openings offered. */
  const pickOpening = (index: number): Promise<boolean> => {
    if (!play?.openings) return Promise.resolve(false);
    const opening = play.openings[index];
    if (!opening) return Promise.resolve(false);
    const ask = { kind: 'pick' as const, opening: index, playOthers };
    const start = blankPending('opening', null, opening.text, play.scene);
    return run(start, (onEvent, signal) => openStory(bookId, ask, onEvent, signal));
  };

  /** Opens the story with the owner's own opening. */
  const ownOpening = (text: string): Promise<boolean> => {
    if (!play) return Promise.resolve(false);
    const ask = { kind: 'own' as const, text, playOthers };
    const start = blankPending('opening', null, text, play.scene);
    return run(start, (onEvent, signal) => openStory(bookId, ask, onEvent, signal));
  };

  /** On to the next scene: the page starts fresh under its heading. */
  const goOnToNext = (): Promise<boolean> => {
    if (!play) return Promise.resolve(false);
    let scene = play.next;
    if (play.stage === 'opening') {
      scene = play.scene;
    }
    const start = { ...blankPending('opening', null, '', scene), fresh: true };
    return run(start, (onEvent, signal) => goOn(bookId, { playOthers }, onEvent, signal));
  };

  /** Another reply to the newest turn. */
  const again = (): Promise<boolean> => {
    if (!play) return Promise.resolve(false);
    const newest = newestOf(play.turns);
    if (!newest) return Promise.resolve(false);
    const start = { ...blankPending(newest.voice, newest.played, newest.input, play.scene), redoing: newest.id };
    return run(start, (onEvent, signal) => another(bookId, { playOthers }, onEvent, signal));
  };

  /** The one about to act is played by their actor this time. */
  const letActor = (): Promise<boolean> => {
    if (!play) return Promise.resolve(false);
    const start = blankPending('actor', play.cue, '', play.scene);
    return run(start, (onEvent, signal) => letActorPlay(bookId, { playOthers }, onEvent, signal));
  };

  /** Takes the newest turn back. Answers with the owner's words for the box, or null if it wasn't. */
  const undo = async (): Promise<Undone | null> => {
    setAsking('undo');
    setError(null);
    setHints(null);
    try {
      const undone = await undoTurn(bookId);
      setPlay(undone.play);
      return undone;
    } catch (e) {
      setError(failureText(e));
      await refresh();
      return null;
    } finally {
      setAsking(null);
    }
  };

  const askForHints = async () => {
    const controller = startWork();
    setAsking('hints');
    setError(null);
    setHints(null);
    try {
      setHints(await askHints(bookId, controller.signal));
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(failureText(e));
    } finally {
      setAsking(null);
      endWork(controller);
    }
  };

  const changePlayOthers = (value: boolean) => {
    setPlayOthers(value);
    writePlayOthers(bookId, value);
  };

  let busy = false;
  if (pending !== null || asking !== null) {
    busy = true;
  }

  return {
    loaded,
    play,
    pending,
    asking,
    busy,
    hints,
    error,
    playOthers,
    move,
    pickOpening,
    ownOpening,
    goOn: goOnToNext,
    again,
    letActor,
    undo,
    askForOpenings,
    askForHints,
    hideHints: () => setHints(null),
    changePlayOthers,
  };
}

export type PlayState = ReturnType<typeof usePlay>;
