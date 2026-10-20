import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderConfig } from '@/shared/types/config';
import { AgentError } from '@/shared/utils/errors';
import { createClient } from '.';
import { RETRY_DELAYS_MS } from './http';
import type { ChatMessage } from './types';

const provider = (over: Partial<ProviderConfig>): ProviderConfig => ({
  id: 'p',
  name: 'P',
  kind: 'openai',
  preset: 'custom',
  baseUrl: 'http://localhost:9999/v1',
  apiKey: '',
  defaultModel: 'm',
  createdAt: 0,
  ...over,
});

const conversation: ChatMessage[] = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'do it' },
  { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'click', arguments: { id: 3 } }] },
  { role: 'tool', toolCallId: 'c1', toolName: 'click', content: 'Clicked.' },
];
const tools = [{ name: 'click', description: 'Click', parameters: { type: 'object', properties: { id: { type: 'number' } } } }];

function mockFetch(reply: unknown, status = 200) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(reply), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('Ollama native adapter', () => {
  it('sends num_ctx and think:false, maps tool turns, parses tool calls', async () => {
    const fetchMock = mockFetch({ message: { content: '', tool_calls: [{ function: { name: 'click', arguments: { id: 7 } } }] }, prompt_eval_count: 10, eval_count: 2 });
    const client = createClient(provider({ kind: 'ollama', baseUrl: 'http://localhost:11434/v1', skipThinking: true, contextWindow: 16384 }));
    const res = await client.chat({ model: 'qwen3.5:4b', messages: conversation, tools, temperature: 0.2 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:11434/api/chat');
    const body = JSON.parse(init!.body as string);
    expect(body.options).toEqual({ temperature: 0.2, num_ctx: 16384 });
    expect(body.think).toBe(false);
    expect(body.messages[2].tool_calls[0].function).toEqual({ name: 'click', arguments: { id: 3 } });
    expect(body.messages[3]).toEqual({ role: 'tool', content: 'Clicked.', tool_name: 'click' });
    expect(res.toolCalls[0]).toMatchObject({ name: 'click', arguments: { id: 7 } });
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 2 });
  });
});

describe('OpenAI-compatible adapter', () => {
  it('serializes tool calls and parses string arguments', async () => {
    const fetchMock = mockFetch({ choices: [{ message: { content: '<think>x</think>', tool_calls: [{ id: 'z', function: { name: 'click', arguments: '{"id": "4",}' } }] } }] });
    const res = await createClient(provider({ apiKey: 'k' })).chat({ model: 'm', messages: conversation, tools, temperature: 0 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:9999/v1/chat/completions');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer k');
    const body = JSON.parse(init!.body as string);
    expect(body.messages[2].tool_calls[0]).toEqual({ id: 'c1', type: 'function', function: { name: 'click', arguments: '{"id":3}' } });
    expect(body.messages[3]).toMatchObject({ role: 'tool', tool_call_id: 'c1' });
    expect(body.reasoning_effort).toBeUndefined();
    expect(res.content).toBe('');
    expect(res.toolCalls[0]).toMatchObject({ id: 'z', name: 'click', arguments: { id: '4' } });
  });

  it('tries again when the connection drops for a moment or the server is busy', async () => {
    RETRY_DELAYS_MS.splice(0, RETRY_DELAYS_MS.length, 0, 0);
    const ok = new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }));
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(new Response('busy', { status: 503 })).mockResolvedValueOnce(ok);
    vi.stubGlobal('fetch', fetchMock);
    const res = await createClient(provider({})).chat({ model: 'm', messages: conversation, tools, temperature: 0 });
    expect(res.content).toBe('hi');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('turns HTTP failures into friendly errors', async () => {
    mockFetch({ error: 'nope' }, 401);
    await expect(createClient(provider({})).chat({ model: 'm', messages: conversation, tools, temperature: 0 })).rejects.toMatchObject({ code: 'model_auth' });
    RETRY_DELAYS_MS.splice(0, RETRY_DELAYS_MS.length, 0, 0);
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const err = await createClient(provider({})).chat({ model: 'm', messages: conversation, tools, temperature: 0 }).catch((e) => e);
    expect(err).toBeInstanceOf(AgentError);
    expect(err.code).toBe('model_unreachable');
    expect(err.userMessage).toContain('localhost:9999');
  });
});

describe('Anthropic adapter', () => {
  it('merges tool results into one user turn and reads tool_use blocks', async () => {
    const fetchMock = mockFetch({ content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 't1', name: 'click', input: { id: 2 } }], stop_reason: 'tool_use' });
    const res = await createClient(provider({ kind: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'k' })).chat({ model: 'claude-sonnet-5-5', messages: conversation, tools, temperature: 0 });
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body.system).toBe('sys');
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(body.messages[2].content[0]).toEqual({ type: 'tool_result', tool_use_id: 'c1', content: 'Clicked.' });
    expect(body.tools[0]).toHaveProperty('input_schema');
    expect(res).toMatchObject({ content: 'ok', toolCalls: [{ id: 't1', name: 'click', arguments: { id: 2 } }] });
  });
});
