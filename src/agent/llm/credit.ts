import type { ProviderConfig } from '@/shared/types/config';
import { requestJson } from './http';

/** What an OpenRouter key may still spend: its own limit, and the account's balance behind it. */
export interface Credit {
  /** Dollars this key can still spend — the smaller of its limit's rest and the account's balance; null: no limit known. */
  left: number | null;
  /** The key's own spending limit, when it has one. */
  keyLimit?: number;
  keyUsed: number;
  /** The account's credits bought and used — not every key may read them. */
  account?: { total: number; used: number };
  /** What the key spent this UTC day, week (from Monday) and month, as OpenRouter counts it — every use of the key. */
  spent?: { day: number; week: number; month: number };
}

/** Under this many dollars the side panel warns that the credit is running out. */
export const LOW_CREDIT = 0.5;

export const hasCredit = (provider: Pick<ProviderConfig, 'baseUrl'>) => /^https:\/\/openrouter\.ai\//.test(provider.baseUrl);

interface KeyInfo {
  data: { limit: number | null; limit_remaining: number | null; usage: number; usage_daily?: number; usage_weekly?: number; usage_monthly?: number };
}
interface Credits {
  data: { total_credits: number; total_usage: number };
}

/** The key's credit from OpenRouter (GET /key and /credits). */
export async function fetchCredit(provider: Pick<ProviderConfig, 'baseUrl' | 'apiKey'>, signal?: AbortSignal): Promise<Credit> {
  const base = provider.baseUrl.replace(/\/+$/, '');
  const init = { headers: { Authorization: `Bearer ${provider.apiKey}` }, signal, timeoutMs: 20_000 };
  const [key, credits] = await Promise.all([requestJson<KeyInfo>(`${base}/key`, init), requestJson<Credits>(`${base}/credits`, init).catch(() => null)]);
  const account = credits ? { total: credits.data.total_credits, used: credits.data.total_usage } : undefined;
  const fromKey = key.data.limit_remaining ?? Infinity;
  const fromAccount = account ? account.total - account.used : Infinity;
  return {
    left: Number.isFinite(Math.min(fromKey, fromAccount)) ? Math.max(0, Math.min(fromKey, fromAccount)) : null,
    ...(key.data.limit != null ? { keyLimit: key.data.limit } : {}),
    keyUsed: key.data.usage,
    ...(account ? { account } : {}),
    ...(typeof key.data.usage_daily === 'number'
      ? { spent: { day: key.data.usage_daily, week: key.data.usage_weekly ?? 0, month: key.data.usage_monthly ?? 0 } }
      : {}),
  };
}

export const dollars = (n: number) => `$${n.toFixed(2)}`;

/** “$5.03 left · key limit $15.00, $9.97 used · account $72.65 of $100.00” */
export function describeCredit(c: Credit): string {
  const parts = [c.left == null ? 'no spending limit' : `${dollars(c.left)} left`];
  if (c.keyLimit != null) parts.push(`key limit ${dollars(c.keyLimit)}, ${dollars(c.keyUsed)} used`);
  if (c.account) parts.push(`account ${dollars(c.account.total - c.account.used)} of ${dollars(c.account.total)}`);
  return parts.join(' · ');
}
