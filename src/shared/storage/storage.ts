import { isExtensionContext } from '../utils';

/**
 * The one way the extension keeps anything: every read, write and change listener goes through here — the setup,
 * the knowledge bases, a crawl kept while it runs, the history, the cost record, the chat across panel reloads.
 * Nothing else calls chrome.storage (a test checks), so moving the data elsewhere (Firebase, per signed-in user)
 * is one backend written and set with `useStorageBackend` — not a change all over the code.
 *
 * Two areas, as chrome.storage has them: `local` (kept) and `session` (gone when the browser closes).
 */
export type Area = 'local' | 'session';

/** What changed in one area: each key with its new value (undefined: removed). */
export type StorageChanges = Record<string, { newValue?: unknown }>;

export interface StorageBackend {
  get(keys: string[], area: Area): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>, area: Area): Promise<void>;
  remove(keys: string[], area: Area): Promise<void>;
  /** Changes made anywhere (another panel, the background worker…); returns the unsubscribe. */
  onChange(listener: (changes: StorageChanges, area: Area) => void): () => void;
}

/** chrome.storage — the extension's own storage, shared by its pages and its background worker. */
const chromeBackend: StorageBackend = {
  get: (keys, area) => chrome.storage[area].get(keys),
  set: (items, area) => chrome.storage[area].set(items),
  remove: (keys, area) => chrome.storage[area].remove(keys),
  onChange(listener) {
    const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' || area === 'session') listener(changes, area);
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  },
};

/** The page's own storage — for the UI running outside the extension (`vite`, tests). */
const browserBackend: StorageBackend = {
  async get(keys, area) {
    const store = area === 'session' ? sessionStorage : localStorage;
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      const raw = store.getItem(k);
      if (raw !== null) out[k] = JSON.parse(raw);
    }
    return out;
  },
  async set(items, area) {
    const store = area === 'session' ? sessionStorage : localStorage;
    for (const [k, v] of Object.entries(items)) store.setItem(k, JSON.stringify(v));
    window.dispatchEvent(new CustomEvent('wa-storage', { detail: { changes: Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { newValue: v }])), area } }));
  },
  async remove(keys, area) {
    const store = area === 'session' ? sessionStorage : localStorage;
    for (const k of keys) store.removeItem(k);
    window.dispatchEvent(new CustomEvent('wa-storage', { detail: { changes: Object.fromEntries(keys.map((k) => [k, {}])), area } }));
  },
  onChange(listener) {
    // This page's own writes, and another tab's (the browser's storage event).
    const own = (e: Event) => {
      const d = (e as CustomEvent).detail as { changes: StorageChanges; area: Area };
      listener(d.changes, d.area);
    };
    const other = (e: StorageEvent) => {
      if (!e.key) return;
      listener({ [e.key]: { newValue: e.newValue === null ? undefined : JSON.parse(e.newValue) } }, e.storageArea === sessionStorage ? 'session' : 'local');
    };
    window.addEventListener('wa-storage', own);
    window.addEventListener('storage', other);
    return () => {
      window.removeEventListener('wa-storage', own);
      window.removeEventListener('storage', other);
    };
  },
};

let chosen: StorageBackend | null = null;
const backend = (): StorageBackend => chosen ?? (isExtensionContext() ? chromeBackend : browserBackend);

/** Keeps everything elsewhere from now on (Firebase, a test's memory). Null: the default again. */
export function useStorageBackend(b: StorageBackend | null): void {
  chosen = b;
}

export async function getItem<T>(key: string, area: Area = 'local'): Promise<T | undefined> {
  const r = await backend().get([key], area);
  return r[key] as T | undefined;
}

/** Several keys at once (missing ones are left out). */
export async function getItems(keys: string[], area: Area = 'local'): Promise<Record<string, unknown>> {
  return keys.length ? backend().get(keys, area) : {};
}

export async function setItem<T>(key: string, value: T, area: Area = 'local'): Promise<void> {
  await backend().set({ [key]: value }, area);
}

export async function removeItem(key: string, area: Area = 'local'): Promise<void> {
  await backend().remove([key], area);
}

/** Calls `listener` with the new value whenever `key` changes, in any part of the extension. */
export function watchItem<T>(key: string, listener: (value: T | undefined) => void, area: Area = 'local'): () => void {
  return backend().onChange((changes, a) => {
    if (a === area && key in changes) listener(changes[key].newValue as T | undefined);
  });
}

/** Calls `listener` with the keys among `keys` that changed (in one area) — for reacting to several at once. */
export function watchKeys(keys: string[], listener: (changed: string[]) => void, area: Area = 'local'): () => void {
  return backend().onChange((changes, a) => {
    if (a !== area) return;
    const changed = keys.filter((k) => k in changes);
    if (changed.length) listener(changed);
  });
}
