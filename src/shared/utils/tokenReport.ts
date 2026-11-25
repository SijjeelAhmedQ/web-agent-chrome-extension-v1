import type { TaskRecord } from '../types/history';

/**
 * What each task cost in tokens, one row per task — to measure before and after a change (the same tasks run
 * again). Taken from the calls the history keeps: the server's counts, and what each prompt was made of.
 */
export interface TaskTokens {
  started: string;
  request: string;
  site: string;
  status: string;
  model: string;
  calls: number;
  steps: number;
  tokensIn: number;
  /** Of the input, read from the prompt cache (billed at a tenth). */
  cached: number;
  /** Input paid in full: in − cached. */
  newIn: number;
  out: number;
  cost: number;
  seconds: number;
  /** Per call, on average (estimated tokens): what the prompt was made of. */
  avgSystem: number;
  avgKnowledge: number;
  avgTools: number;
  avgPages: number;
  avgRest: number;
}

export function taskTokens(t: TaskRecord): TaskTokens {
  const calls = t.calls ?? [];
  const sum = (f: (c: (typeof calls)[number]) => number | undefined) => calls.reduce((n, c) => n + (f(c) ?? 0), 0);
  const avg = (p: 'system' | 'knowledge' | 'tools' | 'pages' | 'rest') => Math.round(sum((c) => c.parts?.[p]) / Math.max(1, calls.length));
  const tokensIn = sum((c) => c.inputTokens);
  const cached = sum((c) => c.cachedTokens);
  return {
    started: new Date(t.startedAt).toISOString(),
    request: t.request,
    site: t.site,
    status: t.status,
    model: [...new Set(calls.map((c) => c.servedBy || c.model))].join(' + '),
    calls: calls.length,
    steps: t.steps.length,
    tokensIn,
    cached,
    newIn: tokensIn - cached,
    out: sum((c) => c.outputTokens),
    cost: +sum((c) => c.cost).toFixed(6),
    seconds: t.endedAt ? Math.round((t.endedAt - t.startedAt) / 1000) : 0,
    avgSystem: avg('system'),
    avgKnowledge: avg('knowledge'),
    avgTools: avg('tools'),
    avgPages: avg('pages'),
    avgRest: avg('rest'),
  };
}

const COLUMNS: [keyof TaskTokens, string][] = [
  ['started', 'started'],
  ['request', 'request'],
  ['site', 'site'],
  ['status', 'status'],
  ['model', 'model'],
  ['calls', 'calls'],
  ['steps', 'steps'],
  ['tokensIn', 'tokens_in'],
  ['cached', 'cached'],
  ['newIn', 'new_in'],
  ['out', 'tokens_out'],
  ['cost', 'cost_usd'],
  ['seconds', 'seconds'],
  ['avgSystem', 'avg_system'],
  ['avgKnowledge', 'avg_knowledge'],
  ['avgTools', 'avg_tools'],
  ['avgPages', 'avg_pages'],
  ['avgRest', 'avg_rest'],
];

const cell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The tasks as CSV (oldest first), with a last row of totals — opens in Excel or Google Sheets. */
export function tokenReportCsv(tasks: TaskRecord[]): string {
  const rows = [...tasks].sort((a, b) => a.startedAt - b.startedAt).map(taskTokens);
  const total = (k: keyof TaskTokens) => rows.reduce((n, r) => n + (r[k] as number), 0);
  const lines = [COLUMNS.map(([, h]) => h).join(','), ...rows.map((r) => COLUMNS.map(([k]) => cell(r[k])).join(','))];
  if (rows.length > 1) {
    const totals: Partial<Record<keyof TaskTokens, string | number>> = {
      request: `TOTAL (${rows.length} tasks)`,
      calls: total('calls'),
      steps: total('steps'),
      tokensIn: total('tokensIn'),
      cached: total('cached'),
      newIn: total('newIn'),
      out: total('out'),
      cost: +total('cost').toFixed(6),
      seconds: total('seconds'),
    };
    lines.push(COLUMNS.map(([k]) => cell(totals[k] ?? '')).join(','));
  }
  return `${lines.join('\n')}\n`;
}
