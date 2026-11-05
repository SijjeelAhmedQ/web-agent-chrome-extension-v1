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
  if (!calls.length) return null;
  const s = summarizeCalls(calls);
  const cost = s.priced ? formatCost(s.cost) : 'cost not reported';
  const estimate = describeEstimate(calls);
  return (
    <section className="cost-log" aria-label="Model calls">
      <button type="button" className="cost-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>
          Model calls · {s.calls} · {formatTokens(s.inputTokens)} tokens in{s.cachedTokens ? ` (${formatTokens(s.cachedTokens)} cached)` : ''} · {formatTokens(s.outputTokens)} out ·{' '}
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
});
