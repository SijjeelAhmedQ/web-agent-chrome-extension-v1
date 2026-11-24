import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from './llm';
import { stripKeys } from '@/shared/storage/configStore';
import { defaultConfig } from '@/shared/constants/defaults';

type Call = { url: string; init: RequestInit };

function fakeServers(compress: 'ok' | 'down') {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/v1/compress')) {
        if (compress === 'down') throw new TypeError('Failed to fetch');
        const body = JSON.parse(init.body as string);
        const messages = body.messages.map((m: { role: string; content: unknown }) => (m.role === 'tool' ? { ...m, content: '[page read, compressed]' } : m));
        return new Response(JSON.stringify({ messages, tokens_before: 5000, tokens_after: 1200, tokens_saved: 3800, compression_ratio: 0.24, transforms_applied: ['kompress'], ccr_hashes: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1300, completion_tokens: 5 } }), { status: 200 });
    }),
  );
  return calls;
}

const conversation = [
  { role: 'system' as const, content: 'rules' },
  { role: 'user' as const, content: 'show me all abnormal records' },
  { role: 'assistant' as const, content: '', toolCalls: [{ id: 'r', name: 'read_page', arguments: {} }] },
  { role: 'tool' as const, toolName: 'read_page', toolCallId: 'r', content: 'Page: Smart AI Inbox\n[1] button "Search"\n'.repeat(200) },
];

describe('Headroom (the official SDK and proxy) before each call', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('the model gets the messages Headroom compressed, and the log its numbers', async () => {
    const calls = fakeServers('ok');
    const provider = { id: 'p', name: 'OpenRouter', kind: 'openai', preset: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or', defaultModel: 'm', headroomOn: true, headroomUrl: 'http://localhost:8787', createdAt: 1 } as never;
    const res = await createClient(provider).chat({ model: 'anthropic/claude-haiku-5.5', messages: conversation, tools: [], temperature: 0 });
    expect(calls[0].url).toBe('http://localhost:8787/v1/compress');
    // The OpenRouter key never goes to the proxy.
    expect(JSON.stringify(calls[0].init.headers)).not.toContain('sk-or');
    const sent = JSON.parse(calls[1].init.body as string);
    expect(calls[1].url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(sent.messages.at(-1).content).toBe('[page read, compressed]');
    expect(sent.cache_control).toEqual({ type: 'ephemeral' }); // OpenRouter's settings stay ours
    expect(res.usage?.headroom).toEqual({ before: 5000, after: 1200 });
  });

  it('a proxy out of reach: the messages go as they are, and the task goes on', async () => {
    const calls = fakeServers('down');
    const provider = { id: 'p', name: 'OpenRouter', kind: 'openai', preset: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or', defaultModel: 'm', headroomOn: true, headroomUrl: 'http://localhost:8787', createdAt: 1 } as never;
    const res = await createClient(provider).chat({ model: 'm', messages: conversation, tools: [], temperature: 0 });
    const sent = JSON.parse(calls.at(-1)!.init.body as string);
    expect(sent.messages.at(-1).content).toContain('[1] button "Search"');
    expect(res.content).toBe('ok');
    expect(res.usage?.headroom).toBeUndefined();
  });

  it('off when no proxy is named: nothing goes to Headroom', async () => {
    const calls = fakeServers('ok');
    const provider = { id: 'p', name: 'OpenRouter', kind: 'openai', preset: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k', defaultModel: 'm', createdAt: 1 } as never;
    await createClient(provider).chat({ model: 'm', messages: conversation, tools: [], temperature: 0 });
    expect(calls.some((c) => c.url.includes('/v1/compress'))).toBe(false);
  });

  it('switched off: nothing goes to Headroom, though its address is saved', async () => {
    const calls = fakeServers('ok');
    const provider = { id: 'p', name: 'OpenRouter', kind: 'openai', preset: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k', defaultModel: 'm', headroomUrl: 'http://localhost:8787', createdAt: 1 } as never;
    const res = await createClient(provider).chat({ model: 'm', messages: conversation, tools: [], temperature: 0 });
    expect(calls.some((c) => c.url.includes('/v1/compress'))).toBe(false);
    expect(res.usage?.headroom).toBeUndefined();
  });

  it('the proxy behind the Kaggle notebook gets the notebook’s key, as the model does', async () => {
    const calls = fakeServers('ok');
    const provider = { id: 'k', name: 'Kaggle GPU', kind: 'openai', preset: 'kaggle', baseUrl: 'https://x.trycloudflare.com/vllm/v1', apiKey: 'notebook-key', keyHeader: 'X-CareFlow-Key', defaultModel: 'qwen', headroomOn: true, headroomUrl: 'https://x.trycloudflare.com/headroom', createdAt: 1 } as never;
    await createClient(provider).chat({ model: 'qwen', messages: conversation, tools: [], temperature: 0 });
    expect(calls[0].url).toBe('https://x.trycloudflare.com/headroom/v1/compress');
    expect((calls[0].init.headers as Record<string, string>)['X-Headroom-Proxy-Token']).toBe('notebook-key');
  });

  it('a backup without keys has no proxy token', () => {
    const config = defaultConfig();
    config.providers = [{ id: 'p', name: 'OpenRouter', kind: 'openai', preset: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k', defaultModel: 'm', headroomUrl: 'http://localhost:8787', headroomToken: 'proxy-secret', createdAt: 1 }];
    expect(JSON.stringify(stripKeys(config))).not.toContain('proxy-secret');
  });
});
