import { HeadroomClient } from 'headroom-ai';
import type { ProviderConfig } from '@/shared/types/config';

/** What Headroom made of a call's messages: the messages to send, and the tokens before and after. */
export interface Compressed {
  messages: unknown[];
  before: number;
  after: number;
}

const origin = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
};

/**
 * A call's messages (OpenAI's chat format) through Headroom — the official SDK (npm headroom-ai, `compress`) and its
 * proxy, set per connection (`headroomUrl`). The SDK sends its key as X-Headroom-Proxy-Token: the proxy's token, or —
 * for the proxy behind the Kaggle notebook's own address — the notebook's key, which the notebook checks there.
 * Null when Headroom is off, out of reach, or gave nothing back: the messages then go as they are, and the task goes
 * on (the SDK's own fallback).
 */
export async function headroomCompress(
  provider: Pick<ProviderConfig, 'headroomUrl' | 'headroomToken' | 'baseUrl' | 'apiKey'>,
  messages: unknown[],
  model: string,
): Promise<Compressed | null> {
  const base = provider.headroomUrl?.trim().replace(/\/+$/, '');
  if (!base || !messages.length) return null;
  const key = provider.headroomToken?.trim() || (origin(base) === origin(provider.baseUrl) ? provider.apiKey : '');
  const client = new HeadroomClient({
    baseUrl: base,
    ...(key ? { apiKey: key } : {}),
    // A compression waits on nothing slow: a proxy that hangs is given up on, and the call goes on uncompressed.
    timeout: 20_000,
    retries: 0,
    fallback: true,
  });
  const result = await client.compress(messages as never, { model }).catch(() => null);
  if (!result?.compressed || !Array.isArray(result.messages)) return null;
  return { messages: result.messages as unknown[], before: result.tokensBefore ?? 0, after: result.tokensAfter ?? 0 };
}
