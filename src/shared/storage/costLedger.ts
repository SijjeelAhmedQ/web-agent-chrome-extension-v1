import type { ModelCallRecord, TaskRecord } from '../types/history';
import { loadHistory } from './historyStore';
import { getItem, setItem, watchItem } from './kv';

/**
 * What the agents spent, day by day — kept apart from the task history (200 tasks, and the user may clear it or
 * turn it off), for the Cost page and the side panel's “Today”. Only numbers: the model, the site, the dollars.
 */
export const COST_LEDGER_KEY = 'wa.costLedger';
/** About a year and a month: “this month last year” still adds up. */
const KEEP_DAYS = 400;

export interface CostTally {
  cost: number;
  calls: number;
}

export interface DayCost extends CostTally {
  /** The tasks that made calls that day. */
  taskIds: string[];
  /** By the model that answered. */
  byModel: Record<string, CostTally>;
  /** By the site the task ran on (its host). */
  bySite: Record<string, CostTally>;
  /** Calls with no cost reported — a free or own model (Kaggle, Ollama): nothing spent. */
  unpriced: number;
}

export interface CostLedger {
  /** From when calls are written here as they happen; earlier ones came from the task history. */
  since: number;
  days: Record<string, DayCost>;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The local day of a moment: “2026-11-10”. */
export function dayKey(at: number | Date): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const tally = (map: Record<string, CostTally>, key: string, cost: number) => {
  const t = (map[key] ??= { cost: 0, calls: 0 });
  t.cost += cost;
  t.calls += 1;
};

/** One model call into the ledger (in place). */
export function addCall(ledger: CostLedger, call: Pick<ModelCallRecord, 'at' | 'model' | 'servedBy' | 'cost'>, site: string, taskId: string): void {
  const day = (ledger.days[dayKey(call.at)] ??= { cost: 0, calls: 0, taskIds: [], byModel: {}, bySite: {}, unpriced: 0 });
  const cost = typeof call.cost === 'number' && Number.isFinite(call.cost) ? call.cost : 0;
  day.cost += cost;
  day.calls += 1;
  if (call.cost === undefined) day.unpriced += 1;
  if (!day.taskIds.includes(taskId)) day.taskIds.push(taskId);
  tally(day.byModel, call.servedBy || call.model || 'unknown', cost);
  tally(day.bySite, site || 'Browser', cost);
}

/** The calls the task history still holds from before `before`: the ledger's start, so the first days aren't empty. */
export function ledgerFromHistory(tasks: TaskRecord[], before: number): CostLedger {
  const ledger: CostLedger = { since: before, days: {} };
  for (const task of tasks) for (const call of task.calls ?? []) if (call.at < before) addCall(ledger, call, task.site, task.id);
  return ledger;
}

function prune(ledger: CostLedger, now = Date.now()): CostLedger {
  const oldest = dayKey(now - KEEP_DAYS * 86_400_000);
  for (const key of Object.keys(ledger.days)) if (key < oldest) delete ledger.days[key];
  return ledger;
}

export interface CostSummary extends CostTally {
  tasks: number;
  unpriced: number;
  byModel: [string, CostTally][];
  bySite: [string, CostTally][];
  /** Each day of the range that had calls, newest first. */
  days: [string, DayCost][];
}

function add(into: Record<string, CostTally>, from: Record<string, CostTally>) {
  for (const [key, t] of Object.entries(from)) {
    const sum = (into[key] ??= { cost: 0, calls: 0 });
    sum.cost += t.cost;
    sum.calls += t.calls;
  }
}

/** What was spent from one day to another, both included (“2026-11-04” to “2026-11-10”). */
export function summarize(ledger: CostLedger, from: string, to: string): CostSummary {
  const days = Object.entries(ledger.days)
    .filter(([key]) => key >= from && key <= to)
    .sort(([a], [b]) => (a < b ? 1 : -1));
  const byModel: Record<string, CostTally> = {};
  const bySite: Record<string, CostTally> = {};
  const tasks = new Set<string>();
  let cost = 0;
  let calls = 0;
  let unpriced = 0;
  for (const [, d] of days) {
    cost += d.cost;
    calls += d.calls;
    unpriced += d.unpriced;
    d.taskIds.forEach((id) => tasks.add(id));
    add(byModel, d.byModel);
    add(bySite, d.bySite);
  }
  const ranked = (m: Record<string, CostTally>) => Object.entries(m).sort(([, a], [, b]) => b.cost - a.cost || b.calls - a.calls);
  return { cost, calls, tasks: tasks.size, unpriced, byModel: ranked(byModel), bySite: ranked(bySite), days };
}

/** Days back from today: 0 is today, 1 is yesterday. */
export const daysAgo = (n: number, now = new Date()) => dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));

/** Dollars, with enough places for a cent's fractions: $0.0063, $0.042, $1.27. */
export function money(n: number): string {
  if (n === 0) return '$0.00';
  const abs = Math.abs(n);
  return `$${n.toFixed(abs < 0.01 ? 4 : abs < 1 ? 3 : 2)}`;
}

// Writes are serialized so calls arriving together never drop each other.
let queue: Promise<unknown> = Promise.resolve();
const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
};

/** The ledger — the first time, started from what the task history holds before `before` (the call being written, if any). */
async function loadOrStart(before = Date.now()): Promise<CostLedger> {
  const saved = await getItem<CostLedger>(COST_LEDGER_KEY);
  if (saved?.days) return saved;
  const start = ledgerFromHistory(await loadHistory().catch(() => []), before);
  await setItem(COST_LEDGER_KEY, start);
  return start;
}

export function loadLedger(): Promise<CostLedger> {
  return serialized(loadOrStart);
}

/** A model call as it happens, on the day it was made. */
export function recordCall(call: ModelCallRecord, site: string, taskId: string): Promise<void> {
  return serialized(async () => {
    const ledger = await loadOrStart(call.at);
    addCall(ledger, call, site, taskId);
    await setItem(COST_LEDGER_KEY, prune(ledger));
  });
}

/** A ledger as a backup file holds it (anything else: null). */
export function ledgerIn(raw: unknown): CostLedger | null {
  const l = (raw as { costLedger?: CostLedger } | null)?.costLedger;
  return l && typeof l === 'object' && l.days && typeof l.days === 'object' ? l : null;
}

/**
 * A backup's days into the ledger here: a day only one of them has is taken as it is; a day both have keeps the
 * one with more calls (the same day counted twice would double it). In place; how many days came from the file.
 */
export function mergeLedgers(mine: CostLedger, theirs: CostLedger): number {
  let added = 0;
  for (const [key, day] of Object.entries(theirs.days)) {
    if (!day || typeof day.calls !== 'number') continue;
    if (!mine.days[key] || day.calls > mine.days[key].calls) {
      mine.days[key] = day;
      added++;
    }
  }
  mine.since = Math.min(mine.since, theirs.since ?? mine.since);
  return added;
}

/** The cost record of a backup file brought back (Restore from backup, Add from file). How many days it added. */
export function restoreLedger(raw: unknown): Promise<number> {
  const theirs = ledgerIn(raw);
  if (!theirs) return Promise.resolve(0);
  return serialized(async () => {
    const ledger = await loadOrStart();
    const added = mergeLedgers(ledger, theirs);
    if (added) await setItem(COST_LEDGER_KEY, prune(ledger));
    return added;
  });
}

export function watchLedger(listener: (ledger: CostLedger | undefined) => void): () => void {
  return watchItem<CostLedger>(COST_LEDGER_KEY, listener);
}
