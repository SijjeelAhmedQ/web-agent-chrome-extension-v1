import type { ProviderConfig } from '@/shared/types/config';
import { thinkingOf } from '@/shared/utils';
import { AgentError } from '@/shared/utils/errors';
import { joinUrl, requestJson } from './http';
import type { ChatMessage, ChatRequest, ChatResponse, LlmClient } from './types';

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'redacted_thinking'; data: string };

interface WireMessage {
  role: 'user' | 'assistant';
  content: Block[];
}

interface AnthropicResponse {
  content?: Block[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
}

/** Maps neutral messages to the Messages API: consecutive tool results merge into one user turn. */
function toWire(messages: ChatMessage[]): { system: string; messages: WireMessage[] } {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const out: WireMessage[] = [];
  const push = (role: WireMessage['role'], blocks: Block[]) => {
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user') push('user', [{ type: 'text', text: m.content || ' ' }]);
    else if (m.role === 'tool') push('user', [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }]);
    else {
      // Its thinking first, as it came: Claude refuses a tool turn whose thinking was dropped.
      const blocks: Block[] = Array.isArray(m.reasoning) ? [...(m.reasoning as Block[])] : [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls ?? []) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.arguments });
      push('assistant', blocks.length ? blocks : [{ type: 'text', text: ' ' }]);
    }
  }
  return { system, messages: out };
}

export class AnthropicClient implements LlmClient {
  constructor(private readonly provider: ProviderConfig) {}

  private headers(): Record<string, string> {
    if (!this.provider.apiKey) throw new AgentError('model_auth', 'Add your Anthropic API key in Models.');
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.provider.apiKey,
      'anthropic-version': '2023-06-01',
      // Required for calls made directly from a browser context.
      'anthropic-dangerous-direct-browser-access': 'true',
    };
  }

  private base(): string {
    return this.provider.baseUrl || 'https://api.anthropic.com';
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const { system, messages } = toWire(req.messages);
    // Thinking: a budget of tokens before the answer; with it on, Claude takes no temperature.
    const level = thinkingOf(this.provider);
    const budget = level === 'low' ? 1024 : level === 'high' ? 8192 : 0;
    const data = await requestJson<AnthropicResponse>(joinUrl(this.base(), 'v1/messages'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: req.model,
        max_tokens: 4096 + budget,
        system,
        messages,
        ...(budget ? { thinking: { type: 'enabled', budget_tokens: budget } } : { temperature: req.temperature }),
        ...(req.tools.length ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}),
      }),
      signal: req.signal,
    });
    if (data.error?.message) throw new AgentError('model_error', 'The model returned an error.', data.error.message);
    const blocks = data.content ?? [];
    return {
      content: blocks
        .filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim(),
      toolCalls: blocks
        .filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use')
        .map((b) => ({ id: b.id, name: b.name, arguments: b.input ?? {} })),
      finishReason: data.stop_reason,
      usage: { inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens },
      ...(blocks.some((b) => b.type === 'thinking' || b.type === 'redacted_thinking')
        ? { reasoning: blocks.filter((b) => b.type === 'thinking' || b.type === 'redacted_thinking') }
        : {}),
    };
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const data = await requestJson<{ data?: { id: string }[] }>(joinUrl(this.base(), 'v1/models'), {
      method: 'GET',
      headers: this.headers(),
      signal,
      timeoutMs: 15_000,
    });
    return (data.data ?? []).map((m) => m.id);
  }
}
