import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getItem, getItems, removeItem, setItem, useStorageBackend, watchItem, watchKeys, type Area, type StorageBackend, type StorageChanges } from './storage';

const SRC = join(__dirname, '..', '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

/** A backend in memory — what Firebase will be: one object, set once. */
function memoryBackend(): StorageBackend & { data: Record<Area, Record<string, unknown>> } {
  const data: Record<Area, Record<string, unknown>> = { local: {}, session: {} };
  const listeners = new Set<(c: StorageChanges, a: Area) => void>();
  const tell = (c: StorageChanges, a: Area) => listeners.forEach((l) => l(c, a));
  return {
    data,
    async get(keys, area) {
      return Object.fromEntries(keys.filter((k) => k in data[area]).map((k) => [k, data[area][k]]));
    },
    async set(items, area) {
      Object.assign(data[area], items);
      tell(Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { newValue: v }])), area);
    },
    async remove(keys, area) {
      for (const k of keys) delete data[area][k];
      tell(Object.fromEntries(keys.map((k) => [k, {}])), area);
    },
    onChange(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

describe('all storage goes through storage.ts', () => {
  it('no other file calls chrome.storage, localStorage or sessionStorage', () => {
    const offenders: string[] = [];
    for (const f of files(SRC)) {
      const rel = relative(SRC, f).split(sep).join('/');
      if (rel === 'shared/storage/storage.ts') continue;
      // Code only — a comment may say where things are kept.
      const code = readFileSync(f, 'utf8')
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');
      if (/\bchrome\.storage\b|\blocalStorage\b|\bsessionStorage\b/.test(code)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});

describe('another backend (Firebase, later)', () => {
  afterEach(() => useStorageBackend(null));

  it('is set once, and everything reads, writes and listens through it', async () => {
    const mem = memoryBackend();
    useStorageBackend(mem);
    const seen: unknown[] = [];
    const changedKeys: string[][] = [];
    const stop = watchItem<{ n: number }>('wa.config', (v) => seen.push(v));
    const stopKeys = watchKeys(['wa.config', 'wa.costLedger'], (k) => changedKeys.push(k));

    await setItem('wa.config', { n: 1 });
    await setItem('wa.chat', { draft: 'hi' }, 'session');
    expect(await getItem('wa.config')).toEqual({ n: 1 });
    expect(await getItem('wa.chat', 'session')).toEqual({ draft: 'hi' });
    expect(await getItem('wa.chat')).toBeUndefined(); // the areas are apart
    expect(await getItems(['wa.config', 'missing'])).toEqual({ 'wa.config': { n: 1 } });
    await removeItem('wa.config');
    expect(await getItem('wa.config')).toBeUndefined();

    expect(seen).toEqual([{ n: 1 }, undefined]);
    expect(changedKeys).toEqual([['wa.config'], ['wa.config']]);
    stop();
    stopKeys();
    await setItem('wa.config', { n: 2 });
    expect(seen).toHaveLength(2);
    expect(mem.data.local).toEqual({ 'wa.config': { n: 2 } });
  });
});
