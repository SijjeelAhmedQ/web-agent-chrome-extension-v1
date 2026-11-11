import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from './llm';
import type { ChatMessage } from './llm/types';
import { estimateTokens, FIRST_PAGE, PAGE_AFTER, retireEarlierPages } from './runtime/context';
import { DIFF_HEAD } from './tools/pageDiff';
import { goOnButtons } from './runtime/fillForm';

// A Smart Inbox overview: about 3,000 tokens, as in the user's logs.
const page = (n: number) => `Page: Smart AI Inbox\nURL: https://inbox.test/\n\nInteractive elements (↓ = outside the visible area):\n${Array.from({ length: 140 }, (_, i) => `[${n * 1000 + i}] button "Patient ${i} · NHI ZAA${3400 + i}"`).join('\n')}`;
const act = (id: string, did: string, n: number): ChatMessage[] => [
  { role: 'assistant', content: '', toolCalls: [{ id, name: 'click', arguments: { id: 1 } }] },
  { role: 'tool', toolName: 'click', toolCallId: id, content: `${did}\n\n${PAGE_AFTER}\n${page(n)}` },
];

describe('Headroom: a page read a newer one replaced', () => {
  it('becomes one line — which page — and what the step did stays', () => {
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'rules' },
      { role: 'user', content: 'show me records from 01/10/2026 to 10/11/2026' },
      { role: 'user', content: `${FIRST_PAGE}\n${page(1)}` },
      ...act('a', 'Clicked "Expand search controls".', 2),
      ...act('b', 'Clicked "Search". New on the page: "Filters: Date range".', 3),
    ];
    retireEarlierPages(msgs);
    expect(msgs[2].content).toMatch(/^\(The page as the task starts.*\(Page: Smart AI Inbox\) \[Earlier page snapshot removed/);
    expect(msgs[4].content).toMatch(/^Clicked "Expand search controls"\.\n\(Page: Smart AI Inbox\) \[Earlier page snapshot removed/);
    expect(msgs[6].content).toContain('[3000] button'); // the latest stays whole
    expect(msgs[1].content).toBe('show me records from 01/10/2026 to 10/11/2026');
  });

  it('the changes read after the latest whole read stay, and a read of the page’s text stays', () => {
    const text = `Page: Report\nURL: https://x.test/\n\nPage text:\nHaemoglobin 98 g/L (low)`;
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'rules' },
      { role: 'tool', toolName: 'read_page', toolCallId: 'r', content: text },
      { role: 'tool', toolName: 'read_page', toolCallId: 'p', content: page(1) },
      { role: 'tool', toolName: 'read_page', toolCallId: 'q', content: page(2) },
      { role: 'tool', toolName: 'read_page', toolCallId: 'd', content: `${DIFF_HEAD}:\n+ [9] button "Next"` },
    ];
    retireEarlierPages(msgs);
    expect(msgs[1].content).toBe(text);
    expect(msgs[2].content).toMatch(/^\(Page: Smart AI Inbox\) \[Earlier/);
    expect(msgs[3].content).toContain('[2000] button');
    expect(msgs[4].content).toContain('+ [9] button "Next"');
  });

  it('changes nothing twice: the prompt before the newest step stays as the server cached it', () => {
    const msgs: ChatMessage[] = [{ role: 'system', content: 'rules' }, { role: 'user', content: 'go' }, ...act('a', 'Clicked.', 1), ...act('b', 'Clicked.', 2)];
    retireEarlierPages(msgs);
    const once = msgs.map((m) => m.content);
    retireEarlierPages(msgs);
    expect(msgs.map((m) => m.content)).toEqual(once);
  });

  it('a page with several steps after it stays while the task is short — the cache would be written again', () => {
    // As in the user's run: the first page, then Expand (a read of the changes), Reset, a wait, Expand again…
    const step = (id: string, text: string): ChatMessage[] => [
      { role: 'assistant', content: '', toolCalls: [{ id, name: 'click', arguments: { id: 1 } }] },
      { role: 'tool', toolName: 'click', toolCallId: id, content: text },
    ];
    const steps = Array.from({ length: 8 }, (_, i) => step(`s${i}`, `Clicked "Button ${i}". The page changed: ${'a filter, a count, '.repeat(30)}`)).flat();
    const msgs: ChatMessage[] = [{ role: 'system', content: 'rules' }, { role: 'user', content: 'go' }, { role: 'user', content: `${FIRST_PAGE}\n${page(1)}` }, ...steps, ...act('n', 'Clicked "Search".', 2)];
    retireEarlierPages(msgs);
    expect(msgs[2].content).toContain('[1000] button'); // stays: removing it would rewrite every step after it
    // A long conversation: it goes, whatever the cache.
    const long: ChatMessage[] = [{ role: 'system', content: 'rules' }, { role: 'user', content: 'go' }, { role: 'user', content: `${FIRST_PAGE}\n${page(1)}` }, ...Array.from({ length: 16 }, () => steps).flat(), ...act('n', 'Clicked "Search".', 2)];
    expect(long.reduce((n, m) => n + estimateTokens(m.content), 0)).toBeGreaterThan(20_000);
    retireEarlierPages(long);
    expect(long[2].content).not.toContain('[1000] button');
  });

  it('a seven-call task sends far fewer tokens', () => {
    // What each call carries: the conversation so far (the fixed part — rules, knowledge, tools — aside).
    const run = (retire: boolean) => {
      const msgs: ChatMessage[] = [{ role: 'user', content: 'show me records from 01/10/2026 to 10/11/2026' }, { role: 'user', content: `${FIRST_PAGE}\n${page(0)}` }];
      let sent = 0;
      for (let call = 1; call <= 7; call++) {
        if (retire) retireEarlierPages(msgs);
        sent += msgs.reduce((n, m) => n + estimateTokens(m.content), 0);
        msgs.push(...act(`c${call}`, 'Clicked.', call));
      }
      return sent;
    };
    const before = run(false);
    const after = run(true);
    expect(after).toBeLessThan(before * 0.35); // the conversation's part: about two thirds less
  });
});

describe('fill_form names the button that goes on', () => {
  // The Smart Inbox's search bar, as an overview lists it — by importance, not page order.
  const onPage = [
    { id: 1217, name: 'Search', role: 'button' },
    { id: 1206, name: 'Date range', role: 'textbox' },
    { id: 1207, name: 'Date range', role: 'textbox' },
    { id: 1210, name: 'Status (All)', role: 'combobox' },
    { id: 1216, name: 'Reset', role: 'button' },
    { id: 1218, name: 'Update & Search', role: 'button' },
    { id: 1537, name: 'Expand search controls', role: 'button' },
    { id: 1300, name: 'Save diagnostic comment', role: 'button' },
  ];

  it('Search, after the fields — not Reset, not “Update & Search”, nothing far off', () => {
    expect(goOnButtons(onPage, [1206, 1207, 1210])).toEqual([{ id: 1217, name: 'Search' }]);
  });

  it('none when there is none', () => {
    expect(goOnButtons(onPage, [1300])).toEqual([]);
    expect(goOnButtons(onPage, [])).toEqual([]);
  });
});

describe('Headroom: Claude caches the whole conversation', () => {
  afterEach(() => vi.unstubAllGlobals());
  const bodyFor = async (model: string, baseUrl = 'https://openrouter.ai/api/v1') => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = { id: 'p', name: 'OpenRouter', kind: 'openai', preset: 'openrouter', baseUrl, apiKey: 'k', defaultModel: model, createdAt: 1 } as never;
    await createClient(provider).chat({ model, messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }], tools: [], temperature: 0 });
    return JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  };

  it('Claude on OpenRouter: the automatic mark, moved to the end by the server', async () => {
    const body = await bodyFor('anthropic/claude-haiku-5.5');
    expect(body.cache_control).toEqual({ type: 'ephemeral' });
    expect(body.messages[0].content[0].cache_control).toEqual({ type: 'ephemeral' }); // the system prompt's, as before
  });

  it('others not: DeepSeek caches by itself, Gemini takes only its last mark', async () => {
    expect((await bodyFor('deepseek/deepseek-v4-flash')).cache_control).toBeUndefined();
    expect((await bodyFor('google/gemini-flash')).cache_control).toBeUndefined();
    expect((await bodyFor('anthropic/claude-haiku-5.5', 'http://localhost:11434/v1')).cache_control).toBeUndefined();
  });
});
