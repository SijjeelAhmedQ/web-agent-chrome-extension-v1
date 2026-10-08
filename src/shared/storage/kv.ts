import { isExtensionContext } from '../utils';

/**
 * Minimal key-value storage over chrome.storage, with a localStorage fallback so the UI
 * can also run under `vite` / tests outside the extension.
 */

export type Area = 'local' | 'session';

export async function getItem<T>(key: string, area: Area = 'local'): Promise<T | undefined> {
  if (isExtensionContext()) {
    const store = area === 'session' ? chrome.storage.session : chrome.storage.local;
    const result = await store.get(key);
    return result[key] as T | undefined;
  }
  const raw = (area === 'session' ? sessionStorage : localStorage).getItem(key);
  return raw ? (JSON.parse(raw) as T) : undefined;
}

export async function setItem<T>(key: string, value: T, area: Area = 'local'): Promise<void> {
  if (isExtensionContext()) {
    const store = area === 'session' ? chrome.storage.session : chrome.storage.local;
    await store.set({ [key]: value });
    return;
  }
  (area === 'session' ? sessionStorage : localStorage).setItem(key, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent('wa-storage', { detail: { key, area } }));
}

export async function removeItem(key: string, area: Area = 'local'): Promise<void> {
  if (isExtensionContext()) {
    await (area === 'session' ? chrome.storage.session : chrome.storage.local).remove(key);
    return;
  }
  (area === 'session' ? sessionStorage : localStorage).removeItem(key);
  window.dispatchEvent(new CustomEvent('wa-storage', { detail: { key, area } }));
}

/** Calls `listener` with the new value whenever `key` changes in any extension context. */
export function watchItem<T>(key: string, listener: (value: T | undefined) => void, area: Area = 'local'): () => void {
  if (isExtensionContext()) {
    const handler = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName === area && key in changes) listener(changes[key].newValue as T | undefined);
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }
  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail as { key: string; area: Area };
    if (detail.key === key && detail.area === area) void getItem<T>(key, area).then(listener);
  };
  const storageHandler = (e: StorageEvent) => {
    if (e.key === key) listener(e.newValue ? (JSON.parse(e.newValue) as T) : undefined);
  };
  window.addEventListener('wa-storage', handler);
  window.addEventListener('storage', storageHandler);
  return () => {
    window.removeEventListener('wa-storage', handler);
    window.removeEventListener('storage', storageHandler);
  };
}
