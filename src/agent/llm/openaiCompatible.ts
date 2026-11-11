import type { ProviderConfig } from '@/shared/types/config';
import { thinkingOf } from '@/shared/utils';
import { AgentError } from '@/shared/utils/errors';
import { joinUrl, requestJson } from './http';
import { extractTextToolCalls, parseArguments, stripThinking } from './parse';
import type { ChatMessage, ChatRequest, ChatResponse, LlmClient, ToolCall, Usage } from './types';

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null | { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }[];
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
  reasoning_details?: unknown;
}

interface OpenAIResponse {
  choices?: {
    message?: {
      content?: string | null;
      reasoning_content?: string;
      reasoning_details?: unknown[];
      tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[];
    };
    finish_reason?: string;
  }[];
  /** The model that answered (OpenRouter: a router's pick). */
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    /** OpenRouter: what the call cost, in dollars. */
    cost?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  error?: { message?: string };
}

/** The usage a reply reports, without the fields it left out. */
export function usageOf(data: Pick<OpenAIResponse, 'usage' | 'model'>): Usage {
  const u = data.usage;
  const usage: Usage = {
    inputTokens: u?.prompt_tokens,
    cachedTokens: u?.prompt_tokens_details?.cached_tokens,
    outputTokens: u?.completion_tokens,
    reasoningTokens: u?.completion_tokens_details?.reasoning_tokens,
    cost: typeof u?.cost === 'number' ? u.cost : undefined,
    servedBy: data.model,
  };
  return Object.fromEntries(Object.entries(usage).filter(([, v]) => v !== undefined)) as Usage;
}

/**
 * `cacheSystem`: the system prompt is marked for the server's prompt cache (Claude through OpenRouter caches only
 * what is marked). It stays the same through a task, so every call after the first reads it at a tenth of the price.
 */
function toWire(messages: ChatMessage[], cacheSystem = false): OpenAIMessage[] {
  return messages.map((m) => {
    switch (m.role) {
      case 'assistant':
        return {
          role: 'assistant',
          content: m.content || (m.toolCalls?.length ? null : ''),
          ...(m.toolCalls?.length
            ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) }
            : {}),
          // The model's reasoning goes back as it came (Gemini 3's thought signatures; OpenRouter only).
          ...(m.reasoning ? { reasoning_details: m.reasoning } : {}),
        };
      case 'tool':
        return { role: 'tool', content: m.content, tool_call_id: m.toolCallId, name: m.toolName };
      case 'system':
        return cacheSystem ? { role: 'system', content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }] } : { role: 'system', content: m.content };
      default:
        return { role: m.role, content: m.content };
    }
  });
}

/**
 * The thinking setting as each server takes it: OpenRouter's `reasoning`, the Kaggle notebook's chat template
 * switch (thinking stays off there unless turned on), everyone else's `reasoning_effort`. Unset → nothing sent.
 */
export function thinkingFields(provider: ProviderConfig): Record<string, unknown> {
  const level = thinkingOf(provider);
  if (!level) return {};
  if (/openrouter\.ai/.test(provider.baseUrl)) return { reasoning: { effort: level === 'off' ? 'none' : level } };
  if (provider.preset === 'kaggle') return level === 'off' ? {} : { chat_template_kwargs: { enable_thinking: true } };
  return { reasoning_effort: level === 'off' ? 'none' : level };
}

const isOpenRouter = (url: string) => /openrouter\.ai/.test(url);
/**
 * Models whose prompt cache is asked for by a mark: Claude caches only what is marked; Gemini caches a repeated
 * prefix by itself only sometimes, a marked one every time. (OpenAI, DeepSeek… cache a repeated prefix themselves.)
 */
const marksCache = (model: string) => /^(anthropic|google)\//i.test(model);
/** Claude takes OpenRouter's automatic mark (one at the top of the request, moved to its end by the server). */
export const cachesConversation = (model: string) => /^~?anthropic\//i.test(model);

const isLocal = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/.test(url);

/** OpenAI Chat Completions — also OpenRouter, Ollama, LM Studio, llama.cpp, vLLM and friends. */
export class OpenAICompatibleClient implements LlmClient {
  constructor(private readonly provider: ProviderConfig) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.provider.apiKey) {
      if (this.provider.keyHeader) h[this.provider.keyHeader] = this.provider.apiKey;
      else h.Authorization = `Bearer ${this.provider.apiKey}`;
    }
    if (/openrouter\.ai/.test(this.provider.baseUrl)) {
      h['HTTP-Referer'] = 'https://github.com/web-agent-chrome-extension';
      h['X-Title'] = 'Web Agent';
    }
    return h;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    if (!this.provider.baseUrl) throw new AgentError('no_model', 'This connection has no address. Add one in Models.');
    const body: Record<string, unknown> = {
      model: req.model,
      messages: toWire(req.messages, isOpenRouter(this.provider.baseUrl) && marksCache(req.model)),
      temperature: req.temperature,
      stream: false,
      ...(req.tools.length
        ? { tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })), tool_choice: 'auto' }
        : {}),
    };
    Object.assign(body, thinkingFields(this.provider));
    // OpenRouter: the reply then says what the call cost and which model answered (kept in the task's log).
    if (isOpenRouter(this.provider.baseUrl)) body.usage = { include: true };
    // Claude: the whole conversation cached as well, not only the system prompt — OpenRouter's automatic mark moves
    // to the end of each request, so the next step reads every earlier step and page at a tenth of the price
    // (written once at 1.25×). Without it each step paid in full for all the steps before it.
    if (isOpenRouter(this.provider.baseUrl) && cachesConversation(req.model)) body.cache_control = { type: 'ephemeral' };
    // OpenRouter holds back credit for the model's whole output limit (65k tokens) unless told less — a key with
    // little left then fails every request. A step's reply is far shorter; high thinking gets more room.
    if (/openrouter\.ai/.test(this.provider.baseUrl)) body.max_tokens = thinkingOf(this.provider) === 'high' ? 16_384 : 8_192;
    // The Kaggle notebook (Ollama underneath) has no limit of its own: a model that fell into repeating one line
    // wrote 8,000 tokens — ten minutes on a T4 — before it stopped. A step, or an answer, is far shorter.
    else if (this.provider.preset === 'kaggle') body.max_tokens = { off: 4_096, low: 8_192, high: 16_384 }[thinkingOf(this.provider) ?? 'off'];
    const send = () =>
      requestJson<OpenAIResponse>(joinUrl(this.provider.baseUrl, 'chat/completions'), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: req.signal,
        timeoutMs: this.provider.timeoutMs ?? (isLocal(this.provider.baseUrl) ? 300_000 : 180_000),
      });
    let data: OpenAIResponse;
    try {
      data = await send();
    } catch (err) {
      // Servers that don't know the thinking setting reject it — retry once without.
      const fields = ['reasoning_effort', 'reasoning', 'chat_template_kwargs'].filter((k) => k in body);
      if (fields.length && err instanceof AgentError && /reasoning|thinking|chat_template/i.test(err.detail ?? '')) {
        for (const k of fields) delete body[k];
        data = await send();
      } else throw err;
    }
    if (data.error?.message) throw new AgentError('model_error', 'The model returned an error.', data.error.message);
    const choice = data.choices?.[0];
    if (!choice?.message) throw new AgentError('model_bad_output', 'The model sent an empty reply.', JSON.stringify(data).slice(0, 600));

    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? [])
      .filter((c) => c.function?.name)
      .map((c, i) => {
        const { value, error } = parseArguments(c.function?.arguments);
        return { id: c.id || `call_${Date.now()}_${i}`, name: c.function!.name!, arguments: value, parseError: error };
      });
    let content = stripThinking(choice.message.content ?? '');
    if (!toolCalls.length && content) {
      const recovered = extractTextToolCalls(content, new Set(req.tools.map((t) => t.name)));
      if (recovered.calls.length) {
        toolCalls.push(...recovered.calls);
        content = recovered.rest;
      }
    }
    return {
      content,
      toolCalls,
      finishReason: choice.finish_reason,
      usage: usageOf(data),
      ...(choice.message.reasoning_details?.length ? { reasoning: choice.message.reasoning_details } : {}),
    };
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const data = await requestJson<{ data?: { id: string }[]; models?: { name?: string; model?: string }[] }>(joinUrl(this.provider.baseUrl, 'models'), {
      method: 'GET',
      headers: this.headers(),
      signal,
      timeoutMs: 15_000,
    });
    const ids = data.data?.map((m) => m.id) ?? data.models?.map((m) => m.model ?? m.name ?? '') ?? [];
    return ids.filter(Boolean).sort((a, b) => a.localeCompare(b));
  }
}
