import { Button, Segmented } from 'antd';
import { RefreshCw, Wallet } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchCredit, hasCredit, type Credit } from '@/agent/llm/credit';
import { modelLabel } from '@/shared/constants/providers';
import { daysAgo, dayKey, loadLedger, money, summarize, watchLedger, type CostLedger, type CostTally } from '@/shared/storage/costLedger';
import type { ProviderConfig, SiteProfile } from '@/shared/types/config';
import { matchesSite } from '@/shared/utils';
import { toAgentError } from '@/shared/utils/errors';
import { useAppSelector } from '@/store';
import { EmptyBlock, PageHeader, Section } from './parts';

type Range = 'today' | 'two' | 'week' | 'month' | 'thisMonth' | 'custom';

const RANGES: { value: Range; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'two', label: '2 days' },
  { value: 'week', label: '7 days' },
  { value: 'month', label: '30 days' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'custom', label: 'Dates' },
];

function rangeDays(range: Range, custom: { from: string; to: string }): { from: string; to: string } {
  const today = daysAgo(0);
  const now = new Date();
  switch (range) {
    case 'today':
      return { from: today, to: today };
    case 'two':
      return { from: daysAgo(1), to: today };
    case 'week':
      return { from: daysAgo(6), to: today };
    case 'month':
      return { from: daysAgo(29), to: today };
    case 'thisMonth':
      return { from: dayKey(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
    default:
      return custom.from <= custom.to ? custom : { from: custom.to, to: custom.from };
  }
}

/** “Tue 10 Nov 2026” */
const dayLabel = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

/** A site's host as the user named it in Sites (“Smart AI Inbox”), else the host. */
const siteName = (host: string, sites: SiteProfile[]) => sites.find((s) => s.sites.length && matchesSite(`https://${host}/`, s.sites))?.name ?? host;

function Breakdown({ title, rows, name }: { title: string; rows: [string, CostTally][]; name: (key: string) => string }) {
  if (!rows.length) return null;
  return (
    <table className="cost-table">
      <thead>
        <tr>
          <th scope="col">{title}</th>
          <th scope="col" className="num">Calls</th>
          <th scope="col" className="num">Cost</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([key, t]) => (
          <tr key={key}>
            <td>{name(key)}</td>
            <td className="num">{t.calls}</td>
            <td className="num">{money(t.cost)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** What OpenRouter counts for a key: every use of it — the extension, test scripts, anything else. */
function OpenRouterKey({ provider }: { provider: ProviderConfig }) {
  const [credit, setCredit] = useState<Credit | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const check = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      setCredit(await fetchCredit(provider));
    } catch (err) {
      setError(toAgentError(err).userMessage);
    } finally {
      setBusy(false);
    }
  }, [provider]);
  useEffect(() => {
    void check();
  }, [check]);

  return (
    <div className="cost-key">
      <div className="cost-key-head">
        <strong>{provider.name}</strong>
        <Button size="small" icon={<RefreshCw size={13} />} loading={busy} onClick={() => void check()}>
          Refresh
        </Button>
      </div>
      {error ? (
        <div className="muted small">{error}</div>
      ) : credit ? (
        <>
          {credit.spent ? (
            <div className="cost-tiles">
              <div className="cost-tile">
                <span>Today (UTC)</span>
                <strong>{money(credit.spent.day)}</strong>
              </div>
              <div className="cost-tile">
                <span>This week (UTC)</span>
                <strong>{money(credit.spent.week)}</strong>
              </div>
              <div className="cost-tile">
                <span>This month (UTC)</span>
                <strong>{money(credit.spent.month)}</strong>
              </div>
              <div className="cost-tile">
                <span>All time on this key</span>
                <strong>{money(credit.keyUsed)}</strong>
              </div>
            </div>
          ) : (
            <div className="muted small">All time on this key: {money(credit.keyUsed)}. OpenRouter didn’t send today’s, this week’s or this month’s amounts for it.</div>
          )}
          <div className="muted small">
            {credit.left == null ? 'No spending limit on this key.' : `${money(credit.left)} credit left.`} OpenRouter’s days start at midnight UTC (5 am in Pakistan), and it counts every use of the key, not only this extension.
          </div>
        </>
      ) : (
        <div className="muted small">Checking…</div>
      )}
    </div>
  );
}

export function CostPage() {
  const config = useAppSelector((s) => s.config.config);
  const [ledger, setLedger] = useState<CostLedger | null>(null);
  const [range, setRange] = useState<Range>('today');
  const [custom, setCustom] = useState({ from: daysAgo(6), to: daysAgo(0) });

  useEffect(() => {
    void loadLedger().then(setLedger, () => setLedger({ since: Date.now(), days: {} }));
    return watchLedger((l) => l && setLedger(l));
  }, []);

  const { from, to } = rangeDays(range, custom);
  const summary = useMemo(() => (ledger ? summarize(ledger, from, to) : null), [ledger, from, to]);
  const keys = config.providers.filter((p) => hasCredit(p) && p.apiKey);

  return (
    <>
      <PageHeader title="Cost" description="What your agents spent, day by day — from every model call the extension made — and what OpenRouter counts for your key." />

      <Section title="Spent by the extension" description="Each model call’s cost as OpenRouter reported it, on the day it was made (your computer’s days). Free models — Kaggle, Ollama — cost nothing and count only as calls.">
        <div className="cost-range">
          <Segmented<Range> value={range} onChange={setRange} options={RANGES} />
          {range === 'custom' && (
            <div className="cost-dates">
              <label>
                From <input type="date" value={custom.from} max={daysAgo(0)} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} />
              </label>
              <label>
                To <input type="date" value={custom.to} max={daysAgo(0)} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} />
              </label>
            </div>
          )}
        </div>
        {!summary ? (
          <div className="muted small">Loading…</div>
        ) : (
          <>
            <div className="cost-tiles">
              <div className="cost-tile main">
                <span>{from === to ? dayLabel(from) : `${dayLabel(from)} – ${dayLabel(to)}`}</span>
                <strong>{money(summary.cost)}</strong>
              </div>
              <div className="cost-tile">
                <span>Tasks</span>
                <strong>{summary.tasks}</strong>
              </div>
              <div className="cost-tile">
                <span>Model calls</span>
                <strong>{summary.calls}</strong>
              </div>
              <div className="cost-tile">
                <span>Per task</span>
                <strong>{summary.tasks ? money(summary.cost / summary.tasks) : '—'}</strong>
              </div>
            </div>
            {summary.unpriced > 0 && <div className="muted small">{summary.unpriced} of the calls had no cost (a free model).</div>}
            {summary.calls === 0 ? (
              <EmptyBlock icon={<Wallet size={22} />} title="Nothing spent" text="No model calls on these days." />
            ) : (
              <div className="cost-tables">
                {summary.days.length > 1 && (
                  <table className="cost-table">
                    <thead>
                      <tr>
                        <th scope="col">Day</th>
                        <th scope="col" className="num">Tasks</th>
                        <th scope="col" className="num">Calls</th>
                        <th scope="col" className="num">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.days.map(([key, d]) => (
                        <tr key={key}>
                          <td>{dayLabel(key)}</td>
                          <td className="num">{d.taskIds.length}</td>
                          <td className="num">{d.calls}</td>
                          <td className="num">{money(d.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <Breakdown title="Model" rows={summary.byModel} name={modelLabel} />
                <Breakdown title="Site" rows={summary.bySite} name={(host) => siteName(host, config.sites)} />
              </div>
            )}
            {ledger && <div className="muted small">Counted since {new Date(Object.keys(ledger.days).sort()[0] ? `${Object.keys(ledger.days).sort()[0]}T12:00:00` : ledger.since).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} — days before that came from the activity history, as far as it went back.</div>}
          </>
        )}
      </Section>

      <Section title="OpenRouter — your key" description="What OpenRouter itself counts: the real total, with test scripts and any other use of the key.">
        {keys.length ? keys.map((p) => <OpenRouterKey key={p.id} provider={p} />) : <div className="muted small">No OpenRouter connection with a key — add one in Models.</div>}
      </Section>
    </>
  );
}
