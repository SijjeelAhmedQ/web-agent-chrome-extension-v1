import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderConfig, SiteProfile } from '@/shared/types/config';
import type { ModelCallRecord } from '@/shared/types/history';
import { describeCalls, formatCost, summarizeCalls } from '@/shared/utils/cost';
import { createClient } from './llm';
import type { ChatMessage } from './llm/types';
import { knowledgeSection } from './planner/siteKnowledge';
import { DECISION_HEAD, decisionTranscript } from './runtime/agentRun';
import { budgetFor, CLOUD_BUDGET, compactMessages, estimateTokens, FIRST_PAGE } from './runtime/context';
import { meteredClient, promptParts } from './runtime/costLog';

const openrouter: ProviderConfig = { id: 'p', name: 'OpenRouter', kind: 'openai', preset: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k', defaultModel: 'm', createdAt: 0 };
const conversation: ChatMessage[] = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'goto patients' },
];

function mockFetch(reply: unknown) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(reply), { status: 200 }));
  vi.stubGlobal('fetch', fn);
  return fn;
}
afterEach(() => vi.unstubAllGlobals());

const call = (over: Partial<ModelCallRecord>): ModelCallRecord => ({
  at: 0,
  durationMs: 1000,
  role: 'worker',
  purpose: 'Doing a step',
  model: 'google/gemini-3.8-flash',
  inputTokens: 1000,
  outputTokens: 100,
  parts: { system: 100, knowledge: 500, tools: 300, pages: 50, rest: 50 },
  ...over,
});

describe('the cost of each call', () => {
  it('asks OpenRouter for the cost and reads it, the cached tokens and the model that answered', async () => {
    const fetchMock = mockFetch({
      model: 'z-ai/glm-5.3-flash',
      choices: [{ message: { content: 'NEXT: read the page' } }],
      usage: { prompt_tokens: 9000, completion_tokens: 40, cost: 0.0021, prompt_tokens_details: { cached_tokens: 6000 }, completion_tokens_details: { reasoning_tokens: 12 } },
    });
    const res = await createClient(openrouter).chat({ model: 'typesafe/jev-router', messages: conversation, tools: [], temperature: 0 });
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body.usage).toEqual({ include: true });
    expect(res.usage).toEqual({ inputTokens: 9000, cachedTokens: 6000, outputTokens: 40, reasoningTokens: 12, cost: 0.0021, servedBy: 'z-ai/glm-5.3-flash' });
  });

  it('marks the system prompt for the cache for Claude and Gemini through OpenRouter', async () => {
    let fetchMock = mockFetch({ choices: [{ message: { content: 'ok' } }] });
    await createClient(openrouter).chat({ model: 'anthropic/claude-haiku-5.5', messages: conversation, tools: [], temperature: 0 });
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).messages[0].content).toEqual([{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }]);
    fetchMock = mockFetch({ choices: [{ message: { content: 'ok' } }] });
    await createClient(openrouter).chat({ model: 'google/gemini-3.8-flash', messages: conversation, tools: [], temperature: 0 });
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).messages[0].content[0].cache_control).toEqual({ type: 'ephemeral' });
    fetchMock = mockFetch({ choices: [{ message: { content: 'ok' } }] });
    await createClient(openrouter).chat({ model: 'deepseek/deepseek-v4', messages: conversation, tools: [], temperature: 0 });
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).messages[0].content).toBe('sys');
  });

  it('logs every call with what it was for, and stops before a call when told to', async () => {
    const calls: ModelCallRecord[] = [];
    let stop = false;
    const inner = { listModels: async () => [], chat: async () => ({ content: 'done', toolCalls: [], usage: { inputTokens: 5000, cost: 0.004 } }) };
    const client = meteredClient(inner, 'decider', () => 'KNOWLEDGE', (c) => calls.push(c), () => {
      if (stop) throw new Error('limit');
    });
    await client.chat({ model: 'typesafe/jev-router', purpose: 'Deciding the next step', messages: [{ role: 'system', content: 'rules\nKNOWLEDGE' }, ...conversation.slice(1)], tools: [], temperature: 0 });
    expect(calls[0]).toMatchObject({ role: 'decider', purpose: 'Deciding the next step', model: 'typesafe/jev-router', inputTokens: 5000, cost: 0.004 });
    expect(calls[0].parts.knowledge).toBe(estimateTokens('KNOWLEDGE'));
    stop = true;
    await expect(client.chat({ model: 'm', messages: conversation, tools: [], temperature: 0 })).rejects.toThrow('limit');
    expect(calls).toHaveLength(1);
  });

  it('estimates the input when the server counts nothing', async () => {
    const calls: ModelCallRecord[] = [];
    const inner = { listModels: async () => [], chat: async () => ({ content: 'ok', toolCalls: [] }) };
    await meteredClient(inner, 'worker', () => '', (c) => calls.push(c)).chat({ model: 'qwen', messages: conversation, tools: [], temperature: 0 });
    expect(calls[0].estimated).toBe(true);
    expect(calls[0].inputTokens).toBeGreaterThan(0);
  });

  it('counts page reads apart in the prompt', () => {
    const parts = promptParts(
      [...conversation, { role: 'tool', toolName: 'read_page', toolCallId: 'a', content: 'x'.repeat(320) }],
      [{ name: 'click', description: 'Click', parameters: {} }],
      '',
    );
    expect(parts.pages).toBe(estimateTokens('x'.repeat(320)));
    expect(parts.tools).toBeGreaterThan(0);
  });

  it('adds a task up, and writes it out', () => {
    const calls = [call({ cost: 0.002, cachedTokens: 600 }), call({ role: 'decider', model: 'typesafe/jev-router', servedBy: 'anthropic/claude-opus-5', cost: 0.03 }), call({})];
    expect(summarizeCalls(calls)).toMatchObject({ calls: 3, inputTokens: 3000, cachedTokens: 600, priced: 2 });
    expect(summarizeCalls(calls).cost).toBeCloseTo(0.032);
    expect(formatCost(0.0021)).toBe('$0.0021');
    expect(formatCost(0.34)).toBe('$0.340');
    const text = describeCalls(calls);
    expect(text).toMatch(/^Model calls: 3/);
    expect(text).toContain('typesafe/jev-router → anthropic/claude-opus-5');
    expect(text).toContain('cost not reported');
  });
});

describe('fewer tokens per call', () => {
  const indici = (): SiteProfile[] => JSON.parse(readFileSync('knowledge/web-agent-restore-indici.json', 'utf8')).sites.slice(0, 1);

  it('sends rules and the matching workflows in full, and only the titles of the rest', () => {
    const { text } = knowledgeSection(indici(), 'goto patients', 16_000);
    expect(text).toContain('### Workflow: Select a patient from Search & List');
    expect(text).toContain('### Rule: Open a patient by clicking the name');
    expect(text).not.toContain('### Workflow: Add a medication in the consult');
    expect(text).toMatch(/More knowledge for this site[^\n]*“Add a medication in the consult”/);
    // Was the whole knowledge, about 40,000 characters.
    expect(text.length).toBeLessThan(17_000);
  });

  it('puts what the request is about first — a small model’s room holds the workflow and the rule it names', () => {
    // Kaggle's 16k context: about 9,000 characters. All the rules used to fill it before the workflow.
    for (const request of ['goto patients', 'goto patients and select arya STARK']) {
      const { text } = knowledgeSection(indici(), request, 9_011);
      expect(text).toContain('### Workflow: Select a patient from Search & List');
      // Named in the workflow's steps (“as the "Pop-ups when a consult opens" rule says”).
      expect(text).toContain('### Rule: Pop-ups when a consult opens');
    }
  });

  it('doesn’t take an example’s sample names (“arya stark”) for what a workflow is about', () => {
    const { text } = knowledgeSection(indici(), 'goto patients and select arya STARK', 9_011);
    expect(text).not.toContain('### Workflow: Search the inbox with filters');
  });

  it('matches a word in either form (“patients”, “patient”)', () => {
    expect(knowledgeSection(indici(), 'add a recall', 48_000).text).toContain('### Workflow: Add a recall');
    expect(knowledgeSection(indici(), 'show recalls', 48_000).text).toContain('### Workflow: Add a recall');
  });

  it('gives a cloud model room for the latest page, not for the whole task', () => {
    expect(budgetFor(undefined)).toBe(CLOUD_BUDGET);
    expect(CLOUD_BUDGET).toBeLessThanOrEqual(24_000);
  });

  it('gives the decision model only the latest page read in full, and the checklist', () => {
    const page = (n: number) => `Page ${n}\n${'[1] button "Patients"\n'.repeat(80)}`;
    const text = decisionTranscript(
      [
        { role: 'system', content: 'rules' },
        { role: 'user', content: 'goto patients' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'read_page', arguments: {} }] },
        { role: 'tool', toolName: 'read_page', toolCallId: 'a', content: page(1) },
        { role: 'user', content: `${DECISION_HEAD} Jev Router) — do these steps:\n1. open_menu Patients` },
        { role: 'assistant', content: '', toolCalls: [{ id: 'b', name: 'read_page', arguments: {} }] },
        { role: 'tool', toolName: 'read_page', toolCallId: 'b', content: page(2) },
        { role: 'assistant', content: 'The Patients menu is open.' },
      ],
      '## Your checklist for this task\n☐ 1. open patients',
    );
    expect(text).not.toContain('Page 1');
    expect(text).toContain('the page has been read again since');
    expect(text).toContain('Page 2');
    expect(text).toContain('## Your checklist for this task');
  });
});

describe('the page read before the first call', () => {
  const page = (n: number) => `Page ${n}\n${'[1] button "Patients"\n'.repeat(200)}`;
  const conversation = (): ChatMessage[] => [
    { role: 'system', content: 'rules' },
    { role: 'user', content: 'goto patients' },
    { role: 'user', content: `${FIRST_PAGE}\n${page(1)}` },
    { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'read_page', arguments: {} }] },
    { role: 'tool', toolName: 'read_page', toolCallId: 'a', content: page(2) },
  ];

  it('goes once a newer read is in, and is never taken for the request', () => {
    const msgs = compactMessages(conversation(), 1_000);
    expect(msgs[1].content).toBe('goto patients');
    expect(msgs[2].content.startsWith(FIRST_PAGE)).toBe(true);
    expect(msgs[2].content).not.toContain('Page 1');
    expect(msgs[4].content).toContain('Page 2');
  });

  it('is only named for the decision model once the page was read again', () => {
    const text = decisionTranscript(conversation());
    expect(text).toContain('[User or runtime] goto patients');
    expect(text).not.toContain('Page 1');
    expect(text).toContain('Page 2');
  });
});
