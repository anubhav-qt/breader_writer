import { useEffect, useRef, useState } from 'react';
import type { BookSetup } from '@writer/shared/book';
import type { Chat, ChatEvent, SetupChange } from '@writer/shared/chat';
import { approveList, bookChat, readChat, redoItem, sayInChat } from '../../data/chat';
import { ApiError, failureText } from '../../lib/api';

/*
 * The Suggestions chat as the setup page holds it. It lives with the page, not the panel, so
 * closing the panel doesn't stop Procreator answering. A new book's chat is the draft's (chatId);
 * a book's is found by the book.
 */

interface Options {
  bookId: string | null;
  /** A new book's chat, kept with its draft, or null. */
  chatId: string | null;
  /** A chat was started here: a new book's draft keeps it. */
  onChatStarted: (chatId: string) => void;
  /** The page as it stands. */
  setup: BookSetup;
}

/** What the owner just said, and Procreator's words so far, while it answers. */
export interface Pending {
  text: string;
  reply: string;
}

/** The item being redone. */
export interface Redoing {
  entry: number;
  item: number;
}

async function chatFor(chatId: string | null, bookId: string | null): Promise<Chat | null> {
  if (chatId) {
    return readChat(chatId);
  }
  if (bookId) {
    return bookChat(bookId);
  }
  return null;
}

export function useChat({ bookId, chatId, onChatStarted, setup }: Options) {
  const [chat, setChat] = useState<Chat | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [redoing, setRedoing] = useState<Redoing | null>(null);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The chat being talked in: the draft's, the book's once read, or the one just started here.
  const held = useRef<string | null>(null);
  const stream = useRef<AbortController | null>(null);

  useEffect(() => {
    // The chat just started here is the one already shown.
    if (chatId !== null && chatId === held.current) {
      return;
    }
    held.current = chatId;
    setChat(null);
    setError(null);
    if (chatId === null && bookId === null) {
      return;
    }
    let live = true;
    setLoading(true);
    chatFor(chatId, bookId)
      .then((found) => {
        if (!live) return;
        setChat(found);
        if (found) {
          held.current = found.id;
        }
      })
      .catch((e) => {
        if (!live) return;
        // A chat that's gone is no chat: the next words start a new one.
        if (e instanceof ApiError && e.status === 404) {
          held.current = null;
          return;
        }
        setError(failureText(e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [bookId, chatId]);

  useEffect(() => {
    return () => stream.current?.abort();
  }, []);

  /** Reads the chat again, after something went wrong part way. */
  const refresh = async () => {
    const id = held.current;
    if (!id) {
      return;
    }
    try {
      setChat(await readChat(id));
    } catch {
      // What's shown stays; the error already says something went wrong.
    }
  };

  const onEvent = (event: ChatEvent) => {
    if (event.type === 'started') {
      if (held.current !== event.chatId) {
        held.current = event.chatId;
        onChatStarted(event.chatId);
      }
      return;
    }
    if (event.type === 'text') {
      setPending((now) => {
        if (!now) {
          return now;
        }
        return { ...now, reply: now.reply + event.delta };
      });
      return;
    }
    if (event.type === 'done') {
      setChat(event.chat);
      setPending(null);
      return;
    }
    // The owner's words are kept even when Procreator couldn't answer.
    if (event.chat) {
      setChat(event.chat);
    }
    setPending(null);
    setError(event.message);
  };

  /** The owner says something. Answers whether the server took it (if not, the words are the owner's to keep). */
  const say = async (text: string): Promise<boolean> => {
    const controller = new AbortController();
    stream.current = controller;
    setPending({ text, reply: '' });
    setError(null);
    let taken = false;
    const heard = (event: ChatEvent) => {
      if (event.type === 'started') {
        taken = true;
      }
      onEvent(event);
    };
    try {
      await sayInChat({ chatId: held.current, bookId, setup, text }, heard, controller.signal);
    } catch (e) {
      if (controller.signal.aborted) {
        return taken;
      }
      setError(failureText(e));
      if (taken) {
        await refresh();
      }
    } finally {
      setPending(null);
      stream.current = null;
    }
    return taken;
  };

  /** One item of the open list redone with the owner's notes. Answers whether it was. */
  const redo = async (entry: number, item: number, notes: string): Promise<boolean> => {
    const id = held.current;
    if (!id) {
      return false;
    }
    setRedoing({ entry, item });
    setError(null);
    try {
      setChat(await redoItem(id, { entry, item, notes, setup }));
      return true;
    } catch (e) {
      setError(failureText(e));
      // The list may have moved on: the chat says how it stands.
      if (e instanceof ApiError && e.status === 409) {
        await refresh();
      }
      return false;
    } finally {
      setRedoing(null);
    }
  };

  /** The open list approved: the changes for the page to land, or null if it wasn't. */
  const approve = async (entry: number): Promise<SetupChange[] | null> => {
    const id = held.current;
    if (!id) {
      return null;
    }
    setApproving(true);
    setError(null);
    try {
      const approved = await approveList(id, { entry, setup });
      setChat(approved.chat);
      return approved.changes;
    } catch (e) {
      setError(failureText(e));
      if (e instanceof ApiError && e.status === 409) {
        await refresh();
      }
      return null;
    } finally {
      setApproving(false);
    }
  };

  let busy = approving;
  if (pending !== null || redoing !== null) {
    busy = true;
  }

  return { chat, loading, pending, redoing, approving, busy, error, say, redo, approve };
}

export type ChatState = ReturnType<typeof useChat>;
