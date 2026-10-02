import { createStore, get, set, del, clear } from 'idb-keyval';

/*
 * Local persistence. Until the backend exists, books, reading positions and the library key
 * live in this browser's IndexedDB. Falls back to memory when IndexedDB is unavailable.
 */
let idb: ReturnType<typeof createStore> | null = null;
try {
  idb = createStore('breader', 'kv');
} catch {
  idb = null;
}
const memory = new Map<string, unknown>();

/*
 * Safari on iPhone can refuse to put a Blob in IndexedDB, or keep one it can't read back after a
 * reload. So files go in as their bytes and come back out as a Blob. (Blobs stored before this
 * still read as they are.)
 */
interface Bytes { __bytes: ArrayBuffer; type: string }
const isBytes = (v: unknown): v is Bytes => typeof v === 'object' && v !== null && '__bytes' in v;

export const store = {
  async get<T>(key: string): Promise<T | undefined> {
    // Whatever IndexedDB refused lives here, and is the latest value.
    if (memory.has(key)) return memory.get(key) as T;
    if (idb) {
      try {
        const v = await get<unknown>(key, idb);
        return (isBytes(v) ? new Blob([v.__bytes], { type: v.type }) : v) as T | undefined;
      } catch { /* nothing readable */ }
    }
    return undefined;
  },
  async set(key: string, value: unknown): Promise<void> {
    if (idb) {
      try {
        const stored = value instanceof Blob ? ({ __bytes: await value.arrayBuffer(), type: value.type } satisfies Bytes) : value;
        await set(key, stored, idb);
        memory.delete(key);
        return;
      } catch { /* use memory */ }
    }
    memory.set(key, value);
  },
  async del(key: string): Promise<void> {
    memory.delete(key);
    if (idb) {
      try { await del(key, idb); } catch { /* nothing to delete */ }
    }
  },
  async clear(): Promise<void> {
    memory.clear();
    if (idb) {
      try { await clear(idb); } catch { /* nothing to clear */ }
    }
  },
};

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ }
}
