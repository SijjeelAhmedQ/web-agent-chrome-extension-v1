import { Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { daysAgo, loadLedger, money, watchLedger, type CostLedger } from '@/shared/storage/costLedger';
import { openConfiguration } from '../utils/navigation';

/** “Today: $0.042 · 9 tasks” in the side panel — a click opens the Cost page. Updates as calls come in. */
export function TodayCost() {
  const [ledger, setLedger] = useState<CostLedger | null>(null);
  useEffect(() => {
    void loadLedger().then(setLedger, () => undefined);
    return watchLedger((l) => l && setLedger(l));
  }, []);
  // A new day at midnight: re-render now and then.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  if (!ledger) return null;
  const today = ledger.days[daysAgo(0)];
  return (
    <button type="button" className="today-cost" onClick={() => void openConfiguration('/cost')} aria-label="Spent today — open the Cost page">
      <Wallet size={12} aria-hidden />
      Today: <strong>{money(today?.cost ?? 0)}</strong>
      {today ? ` · ${today.taskIds.length} ${today.taskIds.length === 1 ? 'task' : 'tasks'}` : ''}
    </button>
  );
}
