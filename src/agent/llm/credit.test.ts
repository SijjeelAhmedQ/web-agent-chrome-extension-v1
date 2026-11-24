import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeCredit, fetchCredit, hasCredit } from './credit';

const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const openRouter = { baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k' };

// What an OpenRouter key can still spend: its own limit, and the account behind it.
describe('OpenRouter credit', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('takes the smaller of the key limit left and the account balance', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
      url.endsWith('/key') ? answer({ data: { limit: 15, limit_remaining: 5.0253, usage: 9.9747 } }) : answer({ data: { total_credits: 100, total_usage: 27.35 } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const credit = await fetchCredit(openRouter);
    expect(credit.left).toBeCloseTo(5.0253);
    expect(describeCredit(credit)).toBe('$5.03 left · key limit $15.00, $9.97 used · account $72.65 of $100.00');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer k' } });
  });

  it('works when the key may not read the account, and when it has no limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.endsWith('/key') ? answer({ data: { limit: null, limit_remaining: null, usage: 2 } }) : answer({ error: 'forbidden' }, 403))));
    const credit = await fetchCredit(openRouter);
    expect(credit.left).toBeNull();
    expect(describeCredit(credit)).toBe('no spending limit');
  });

  it('is only asked of OpenRouter', () => {
    expect(hasCredit(openRouter)).toBe(true);
    expect(hasCredit({ baseUrl: 'https://abc.trycloudflare.com/vllm/v1' })).toBe(false);
  });
});
