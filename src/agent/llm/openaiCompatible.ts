import type { ProviderConfig } from '@/shared/types/config';
import { thinkingOf } from '@/shared/utils';
import { AgentError } from '@/shared/utils/errors';
import { joinUrl, requestJson } from './http';
import { extractTextToolCalls, parseArguments, stripThinking } from './parse';
import type { ChatMessage, ChatRequest, ChatResponse, LlmClient, ToolCall } from './types';

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
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
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

function toWire(messages: ChatMessage[]): OpenAIMessage[] {
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
      messages: toWire(req.messages),
      temperature: req.temperature,
      stream: false,
      ...(req.tools.length
        ? { tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })), tool_choice: 'auto' }
        : {}),
    };
    Object.assign(body, thinkingFields(this.provider));
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
      usage: { inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens },
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
