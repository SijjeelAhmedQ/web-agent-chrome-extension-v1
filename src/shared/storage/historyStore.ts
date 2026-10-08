import type { TaskRecord } from '../types/history';
import { getItem, removeItem, setItem, watchItem } from './kv';

export const HISTORY_KEY = 'wa.history';
const MAX_TASKS = 200;

export async function loadHistory(): Promise<TaskRecord[]> {
  return (await getItem<TaskRecord[]>(HISTORY_KEY)) ?? [];
}

// Writes are serialized so concurrent updates from one context never drop each other.
let queue: Promise<unknown> = Promise.resolve();
const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
};

export function upsertTask(task: TaskRecord): Promise<void> {
  return serialized(async () => {
    const list = await loadHistory();
    const index = list.findIndex((t) => t.id === task.id);
    if (index >= 0) list[index] = task;
    else list.unshift(task);
    await setItem(HISTORY_KEY, list.slice(0, MAX_TASKS));
  });
}

export function deleteTask(id: string): Promise<void> {
  return serialized(async () => {
    const list = await loadHistory();
    await setItem(HISTORY_KEY, list.filter((t) => t.id !== id));
  });
}

export function clearHistory(): Promise<void> {
  return serialized(() => removeItem(HISTORY_KEY));
}

/**
 * Drops tasks older than the retention window, and marks tasks still “running” whose last
 * activity is before `interruptedBefore` as cancelled (their panel was closed mid-task).
 */
export function pruneHistory(retentionDays: number, interruptedBefore?: number): Promise<void> {
  return serialized(async () => {
    const list = await loadHistory();
    const cutoff = Date.now() - retentionDays * 86400000;
    let changed = false;
    const next = list
      .filter((t) => {
        const keep = t.startedAt >= cutoff;
        if (!keep) changed = true;
        return keep;
      })
      .map((t) => {
        const lastActivity = t.steps.at(-1)?.startedAt ?? t.startedAt;
        if (t.status === 'running' && interruptedBefore !== undefined && lastActivity < interruptedBefore) {
          changed = true;
          return { ...t, status: 'cancelled' as const, endedAt: t.endedAt ?? Date.now(), error: 'Interrupted — the panel was closed.' };
        }
        return t;
      });
    if (changed) await setItem(HISTORY_KEY, next);
  });
}

export function watchHistory(listener: (tasks: TaskRecord[]) => void): () => void {
  return watchItem<TaskRecord[]>(HISTORY_KEY, (v) => listener(v ?? []));
}
