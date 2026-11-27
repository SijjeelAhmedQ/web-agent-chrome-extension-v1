import type { PickableModel, ProviderConfig } from '@/shared/types/config';
import { joinUrl, requestJson } from './http';

/** One model in OpenRouter's list: its id, name, price and whether it can call tools. */
export interface OpenRouterModel {
  id: string;
  name: string;
  /** Dollars per million tokens. */
  price?: { input: number; output: number };
  tools: boolean;
}

interface Listed {
  id: string;
  name?: string;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
}

/** OpenRouter prices a token (“0.00000083”); we say dollars per million. Router models list -1 (it varies). */
function perMillion(value?: string): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 1000) / 1000 : undefined;
}

/** OpenRouter's whole model list (public — no key needed), with each model's price and tool support. */
export async function fetchOpenRouterModels(provider: Pick<ProviderConfig, 'baseUrl'>, signal?: AbortSignal): Promise<OpenRouterModel[]> {
  const data = await requestJson<{ data?: Listed[] }>(joinUrl(provider.baseUrl, 'models'), { method: 'GET', signal, timeoutMs: 20_000 });
  return (data.data ?? []).map((m) => {
    const input = perMillion(m.pricing?.prompt);
    const output = perMillion(m.pricing?.completion);
    return {
      id: m.id,
      name: m.name ?? m.id,
      ...(input !== undefined && output !== undefined ? { price: { input, output } } : {}),
      tools: (m.supported_parameters ?? []).includes('tools'),
    };
  });
}

/** The list with each model's price and tool support from OpenRouter's (a model it doesn't list keeps what it had). */
export function withListedDetails(list: PickableModel[], listed: OpenRouterModel[]): PickableModel[] {
  const byId = new Map(listed.map((m) => [m.id.toLowerCase(), m]));
  return list.map((m) => {
    const found = byId.get(m.id.trim().toLowerCase());
    if (!found) return m;
    const { price: _old, ...rest } = m;
    return { ...rest, ...(found.price ? { price: found.price } : {}), tools: found.tools };
  });
}
