import { AgentError, isAbort } from '@/shared/utils/errors';

/** fetch with friendly, typed errors for every way a model call can fail. */
export async function requestJson<T>(url: string, init: RequestInit & { timeoutMs?: number }): Promise<T> {
  const host = safeHost(url);
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new DOMException('timeout', 'TimeoutError')), init.timeoutMs ?? 180_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout.signal]) : timeout.signal;

  let res: Response;
  try {
    res = await fetch(url, { ...init, signal });
  } catch (err) {
    if (init.signal?.aborted) throw new AgentError('cancelled', 'Stopped.');
    if (timeout.signal.aborted) throw new AgentError('model_unreachable', `The model at ${host} took too long to answer.`, String(err));
    if (isAbort(err)) throw new AgentError('cancelled', 'Stopped.');
    throw new AgentError('model_unreachable', `I couldn't reach the model at ${host}. Check that it's running and the address is right.`, String(err));
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (!res.ok) {
    const detail = `${res.status} ${res.statusText} — ${text.slice(0, 600)}`;
    if (res.status === 401 || res.status === 403) {
      throw new AgentError('model_auth', `${host} refused the request. Check the API key${/localhost|127\.0\.0\.1/.test(host) ? ' or the server’s allowed origins' : ''}.`, detail);
    }
    if (res.status === 404 || /model.*(not found|does not exist)|unknown model|no such model/i.test(text)) {
      throw new AgentError('model_not_found', `The model wasn't found at ${host}. Check the model name in Models.`, detail);
    }
    if (res.status === 429) throw new AgentError('model_rate_limited', 'The model is getting too many requests. Wait a moment and try again.', detail);
    if (res.status === 400 && /tool|function/i.test(text)) {
      throw new AgentError('model_error', "This model doesn't seem to support tool calling. Choose a model that does.", detail);
    }
    throw new AgentError('model_error', `The model returned an error (${res.status}).`, detail);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AgentError('model_bad_output', 'The model sent a reply I couldn’t read.', text.slice(0, 600));
  }
}

export function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export const joinUrl = (base: string, path: string): string => `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
