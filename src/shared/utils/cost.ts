import { REFERENCE_PRICE } from '../constants/providers';
import type { ModelCallRecord } from '../types/history';
import { formatDuration } from './index';

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

/**
 * What these calls would cost on OpenRouter's default model (REFERENCE_PRICE), for a server that reports no cost:
 * `plain` with no prompt cache, `cached` with the part of the prompt that stays the same all task (instructions,
 * knowledge, tools) read from the cache from the second call of each kind on — the cache's price, about a tenth.
 */
export function estimateCost(calls: ModelCallRecord[] = []): { plain: number; cached: number } {
  const p = REFERENCE_PRICE;
  const seen = new Set<string>();
  let plain = 0;
  let cached = 0;
  for (const c of calls) {
    const input = c.inputTokens ?? 0;
    const output = (c.outputTokens ?? 0) * p.output;
    plain += ((input - (c.cachedTokens ?? 0)) * p.input + (c.cachedTokens ?? 0) * p.cachedInput + output) / 1e6;
    // Calls with another prompt start (the decision model's, an answer written without tools) have their own cache.
    const kind = `${c.role}${c.parts.tools ? '' : ' no tools'}`;
    const total = c.parts.system + c.parts.knowledge + c.parts.tools + c.parts.pages + c.parts.rest;
    const fixed = seen.has(kind) && total ? Math.round((input * (c.parts.system + c.parts.knowledge + c.parts.tools)) / total) : 0;
    seen.add(kind);
    const hit = Math.max(fixed, c.cachedTokens ?? 0);
    cached += ((input - hit) * p.input + hit * p.cachedInput + output) / 1e6;
  }
  return { plain, cached };
}

/** “about $0.015 (with the cache) to $0.029 on Gemini 3.8 Flash” — for calls whose server reported no cost. */
export function describeEstimate(calls: ModelCallRecord[] = []): string {
  if (!calls.length || calls.some((c) => typeof c.cost === 'number')) return '';
  const { plain, cached } = estimateCost(calls);
  const range = formatCost(cached) === formatCost(plain) ? formatCost(plain) : `${formatCost(cached)} (with the cache) to ${formatCost(plain)}`;
  return `on OpenRouter's ${REFERENCE_PRICE.model} about ${range}`;
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
  const cost = typeof c.cost === 'number' ? formatCost(c.cost) : 'cost not reported';
  return `${i + 1}. ${c.purpose} · ${model} · ${formatDuration(c.durationMs)} · ${tokens} · ${cost} · ${parts}${c.did ? `\n   → ${c.did}` : ''}`;
}

/** The whole log as text, with its total first. */
export function describeCalls(calls: ModelCallRecord[] = []): string {
  if (!calls.length) return '';
  const s = summarizeCalls(calls);
  const estimate = describeEstimate(calls);
  const total = `Model calls: ${s.calls} · ${s.inputTokens} tokens in (${s.cachedTokens} cached) · ${s.outputTokens} out · ${s.priced ? formatCost(s.cost) : 'cost not reported'}${estimate ? ` (${estimate})` : ''}`;
  return [total, ...calls.map(describeCall)].join('\n');
}
