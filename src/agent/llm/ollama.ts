import type { ProviderConfig } from '@/shared/types/config';
import { AgentError } from '@/shared/utils/errors';
import { joinUrl, requestJson } from './http';
import { extractTextToolCalls, parseArguments, stripThinking } from './parse';
import type { ChatMessage, ChatRequest, ChatResponse, LlmClient, ToolCall } from './types';

export const DEFAULT_CONTEXT_WINDOW = 12288;

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  tool_name?: string;
}

interface OllamaResponse {
  message?: { content?: string; thinking?: string; tool_calls?: { function?: { name?: string; arguments?: unknown } }[] };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

function toWire(messages: ChatMessage[]): OllamaMessage[] {
  return messages.map((m) => {
    if (m.role === 'assistant') {
      return {
        role: 'assistant',
        content: m.content,
        ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.arguments } })) } : {}),
      };
    }
    if (m.role === 'tool') return { role: 'tool', content: m.content, tool_name: m.toolName };
    return { role: m.role, content: m.content };
  });
}

/**
 * Ollama's native /api/chat. Unlike its OpenAI-compatible endpoint it lets us set the
 * context window — essential for browsing, where page snapshots easily exceed Ollama's
 * small default — and switch thinking off for speed.
 */
export class OllamaClient implements LlmClient {
  constructor(private readonly provider: ProviderConfig) {}

  private base(): string {
    // Accept addresses copied from OpenAI-compatible setups (…/v1).
    return this.provider.baseUrl.replace(/\/v1\/?$/, '');
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    if (!this.provider.baseUrl) throw new AgentError('no_model', 'This connection has no address. Add one in Models.');
    const body: Record<string, unknown> = {
      model: req.model,
      messages: toWire(req.messages),
      stream: false,
      options: { temperature: req.temperature, num_ctx: this.provider.contextWindow || DEFAULT_CONTEXT_WINDOW },
      ...(req.tools.length ? { tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}),
    };
    if (this.provider.skipThinking) body.think = false;

    const send = () =>
      requestJson<OllamaResponse>(joinUrl(this.base(), 'api/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: req.signal,
        // Local models can queue behind other apps using the same server.
        timeoutMs: 600_000,
      });
    let data: OllamaResponse;
    try {
      data = await send();
    } catch (err) {
      // Models without a thinking mode may reject the `think` flag — retry once without it.
      if ('think' in body && err instanceof AgentError && /think/i.test(err.detail ?? '')) {
        delete body.think;
        data = await send();
      } else throw err;
    }
    if (data.error) throw new AgentError('model_error', 'The model returned an error.', data.error);

    const toolCalls: ToolCall[] = (data.message?.tool_calls ?? [])
      .filter((c) => c.function?.name)
      .map((c, i) => {
        const { value, error } = parseArguments(c.function?.arguments);
        return { id: `call_${Date.now()}_${i}`, name: c.function!.name!, arguments: value, parseError: error };
      });
    let content = stripThinking(data.message?.content ?? '');
    if (!toolCalls.length && content) {
      const recovered = extractTextToolCalls(content, new Set(req.tools.map((t) => t.name)));
      if (recovered.calls.length) {
        toolCalls.push(...recovered.calls);
        content = recovered.rest;
      }
    }
    return { content, toolCalls, finishReason: data.done_reason, usage: { inputTokens: data.prompt_eval_count, outputTokens: data.eval_count } };
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const data = await requestJson<{ models?: { name?: string; model?: string }[] }>(joinUrl(this.base(), 'api/tags'), { method: 'GET', signal, timeoutMs: 15_000 });
    return [...new Set((data.models ?? []).map((m) => m.model ?? m.name ?? '').filter(Boolean))].sort();
  }
}
