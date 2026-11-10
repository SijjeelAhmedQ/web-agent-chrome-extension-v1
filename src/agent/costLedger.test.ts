import { describe, expect, it } from 'vitest';
import { addCall, daysAgo, dayKey, ledgerFromHistory, money, summarize, type CostLedger } from '@/shared/storage/costLedger';
import type { TaskRecord } from '@/shared/types/history';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

function ledgerOf(calls: [number, string, number | undefined, string, string][]): CostLedger {
  const ledger: CostLedger = { since: 0, days: {} };
  for (const [time, model, cost, site, task] of calls) addCall(ledger, { at: time, model, cost }, site, task);
  return ledger;
}

describe('the cost ledger', () => {
  const ledger = ledgerOf([
    [at(2026, 11, 10, 9), 'anthropic/claude-haiku-5.5', 0.004, 'inbox-app-dev.vitonta.com', 't1'],
    [at(2026, 11, 10, 9), 'anthropic/claude-haiku-5.5', 0.006, 'inbox-app-dev.vitonta.com', 't1'],
    [at(2026, 11, 10, 15), 'qwen3.8:27b-q4_K_M', undefined, 'inbox-app-dev.vitonta.com', 't2'],
    [at(2026, 11, 9, 23, ), 'google/gemini-flash', 0.03, 'indici.test', 't3'],
    [at(2026, 11, 3), 'google/gemini-flash', 0.5, 'indici.test', 't4'],
  ]);

  it('a day: its cost, calls, tasks — a free model counts as a call, not dollars', () => {
    const today = summarize(ledger, '2026-11-10', '2026-11-10');
    expect(today.cost).toBeCloseTo(0.01);
    expect(today.calls).toBe(3);
    expect(today.tasks).toBe(2);
    expect(today.unpriced).toBe(1);
  });

  it('two days, a week: both ends included, each day newest first', () => {
    const two = summarize(ledger, '2026-11-09', '2026-11-10');
    expect(two.cost).toBeCloseTo(0.04);
    expect(two.days.map(([d]) => d)).toEqual(['2026-11-10', '2026-11-09']);
    expect(summarize(ledger, '2026-11-04', '2026-11-10').cost).toBeCloseTo(0.04); // the 3rd is outside
    expect(summarize(ledger, '2026-11-03', '2026-11-10').cost).toBeCloseTo(0.54);
  });

  it('by model and by site, the costliest first', () => {
    const week = summarize(ledger, '2026-11-01', '2026-11-10');
    expect(week.byModel[0][0]).toBe('google/gemini-flash');
    expect(week.byModel[0][1].cost).toBeCloseTo(0.53);
    expect(week.bySite.map(([s]) => s)).toEqual(['indici.test', 'inbox-app-dev.vitonta.com']);
  });

  it('the days by the computer’s own calendar', () => {
    expect(dayKey(at(2026, 11, 10, 0))).toBe('2026-11-10');
    expect(dayKey(at(2026, 11, 9, 23))).toBe('2026-11-09');
    expect(daysAgo(1, new Date(2026, 10, 1, 10))).toBe('2026-10-31');
  });

  it('starts from the history: only calls before it, so none counts twice', () => {
    const task = (id: string, times: number[]) => ({ id, site: 'indici.test', calls: times.map((t) => ({ at: t, model: 'm', cost: 0.01 })) }) as unknown as TaskRecord;
    const start = ledgerFromHistory([task('a', [at(2026, 11, 8), at(2026, 11, 10, 10)]), task('b', [at(2026, 11, 10, 14)])], at(2026, 11, 10, 12));
    expect(summarize(start, '2026-11-01', '2026-11-30').calls).toBe(2); // the call at 14:00 is written as it happens
  });

  it('dollars with a cent’s fractions', () => {
    expect(money(0)).toBe('$0.00');
    expect(money(0.0063)).toBe('$0.0063');
    expect(money(0.042)).toBe('$0.042');
    expect(money(1.268)).toBe('$1.27');
  });
});
