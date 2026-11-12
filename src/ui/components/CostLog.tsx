import { ChevronDown } from 'lucide-react';
import { memo, useState } from 'react';
import type { ModelCallRecord, TaskRoute } from '@/shared/types/history';
import { describeEstimate, describeRoute, formatCost, formatTokens, summarizeCalls } from '@/shared/utils/cost';
import { formatDuration } from '@/shared/utils';

/**
 * A task's model calls: what each was for, which model answered, its tokens and its cost — and what its prompt
 * was made of. Shows where a task's dollars went.
 */
export const CostLog = memo(function CostLog({ calls, route }: { calls: ModelCallRecord[]; route?: TaskRoute }) {
  const [open, setOpen] = useState(false);
  if (!calls.length) {
    const lines = describeRoute(route);
    if (!lines.length) return null;
    return (
      <section className="cost-log" aria-label="Model calls">
        {lines.map((line) => (
          <div key={line} className="cost-detail cost-estimate">
            {line}
          </div>
        ))}
      </section>
    );
  }
  const s = summarizeCalls(calls);
  const cost = s.priced ? formatCost(s.cost) : 'cost not reported';
  const estimate = describeEstimate(calls);
  return (
    <section className="cost-log" aria-label="Model calls">
      <button type="button" className="cost-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>
          Model calls · {s.calls} · {formatTokens(s.inputTokens)} tokens in{s.cachedTokens ? ` (${formatTokens(s.cachedTokens)} cached)` : ''}{headroomSaved(calls) ? ` · Headroom saved ${formatTokens(headroomSaved(calls))}` : ''} · {formatTokens(s.outputTokens)} out ·{' '}
          <strong>{cost}</strong>
        </span>
        <ChevronDown size={14} className={`chev ${open ? 'open' : ''}`} aria-hidden />
      </button>
      {describeRoute(route, calls).map((line) => (
        <div key={line} className="cost-detail cost-estimate">
          {line}
        </div>
      ))}
      {open && estimate && <div className="cost-detail muted cost-estimate">Not billed here — {estimate}</div>}
      {open && (
        <ol className="cost-calls">
          {calls.map((c, i) => (
            <li key={i} className={c.role}>
              <div className="cost-line">
                <span className="cost-purpose">
                  {i + 1}. {c.purpose}
                </span>
                <span className="cost-amount">{typeof c.cost === 'number' ? formatCost(c.cost) : '—'}</span>
              </div>
              <div className="cost-detail">
                {c.tier ? `${c.tier === 'chooser' ? 'Jev' : `${c.tier[0].toUpperCase()}${c.tier.slice(1)} model`} · ` : c.role === 'decider' ? 'Decision model · ' : ''}
                {c.servedBy ? `${c.model} → ${c.servedBy}` : c.model} · {formatDuration(c.durationMs)}
              </div>
              <div className="cost-detail">
                {c.estimated ? '~' : ''}
                {formatTokens(c.inputTokens ?? 0)} in{c.cachedTokens ? ` (${formatTokens(c.cachedTokens)} cached)` : ''} · {c.outputTokens !== undefined ? formatTokens(c.outputTokens) : '?'} out
                {c.reasoningTokens ? ` (${formatTokens(c.reasoningTokens)} thinking)` : ''}
                {c.headroom ? ` · Headroom ${formatTokens(c.headroom.before)} → ${formatTokens(c.headroom.after)}` : ''}
              </div>
              <div className="cost-detail muted">
                Prompt: knowledge {formatTokens(c.parts.knowledge)} · instructions {formatTokens(c.parts.system)} · tools {formatTokens(c.parts.tools)} · pages {formatTokens(c.parts.pages)} · steps{' '}
                {formatTokens(c.parts.rest)}
              </div>
              {c.did && <div className="cost-detail cost-did">→ {c.did}</div>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
});/** Tokens Headroom took out of a task's calls (before − after, as its proxy counted). */
const headroomSaved = (calls: { headroom?: { before: number; after: number } }[]) => calls.reduce((n, c) => n + (c.headroom ? Math.max(0, c.headroom.before - c.headroom.after) : 0), 0);


