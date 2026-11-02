import type { ModelCallRecord } from '../types/history';

/** A task's model calls added up. `cost` counts only the calls whose server reported one (`priced` of them). */
export interface CostSummary {
  calls: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cost: number;
  priced: number;
}

export function summarizeCalls(calls: ModelCallRecord[] = []): CostSummary {
  const sum: CostSummary = { calls: calls.length, inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0, cost: 0, priced: 0 };
  for (const c of calls) {
    sum.inputTokens += c.inputTokens ?? 0;
    sum.cachedTokens += c.cachedTokens ?? 0;
    sum.outputTokens += c.outputTokens ?? 0;
    sum.reasoningTokens += c.reasoningTokens ?? 0;
    if (typeof c.cost === 'number') {
      sum.cost += c.cost;
      sum.priced++;
    }
  }
  return sum;
}

/** “$0.0123” — four places under a cent, so a tenth of a cent still shows. */
export function formatCost(dollars: number): string {
  if (dollars === 0) return '$0';
  return dollars < 0.01 ? `$${dollars.toFixed(4)}` : dollars < 1 ? `$${dollars.toFixed(3)}` : `$${dollars.toFixed(2)}`;
}

/** “12.3k” tokens. */
export function formatTokens(n: number): string {
  return n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** One line of the log, as text: for Copy steps and reports. */
export function describeCall(c: ModelCallRecord, i: number): string {
  const model = c.servedBy && c.servedBy !== c.model ? `${c.model} → ${c.servedBy}` : c.model;
  const tokens = [
    `in ${c.inputTokens ?? '?'}${c.estimated ? ' (estimated)' : ''}`,
    c.cachedTokens ? `cached ${c.cachedTokens}` : '',
    `out ${c.outputTokens ?? '?'}`,
    c.reasoningTokens ? `thinking ${c.reasoningTokens}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  const p = c.parts;
  const parts = `prompt: knowledge ${p.knowledge}, rules ${p.system}, tools ${p.tools}, pages ${p.pages}, steps ${p.rest}`;
  return `${i + 1}. ${c.purpose} · ${model} · ${tokens} · ${typeof c.cost === 'number' ? formatCost(c.cost) : 'cost not reported'} · ${parts}`;
}

/** The whole log as text, with its total first. */
export function describeCalls(calls: ModelCallRecord[] = []): string {
  if (!calls.length) return '';
  const s = summarizeCalls(calls);
  const total = `Model calls: ${s.calls} · ${s.inputTokens} tokens in (${s.cachedTokens} cached) · ${s.outputTokens} out · ${s.priced ? formatCost(s.cost) : 'cost not reported'}`;
  return [total, ...calls.map(describeCall)].join('\n');
}
