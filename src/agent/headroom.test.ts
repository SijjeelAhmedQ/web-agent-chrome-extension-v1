import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from './llm';
import type { ChatMessage } from './llm/types';
import { compactMessages, estimateTokens, FIRST_PAGE, PAGE_AFTER, retireEarlierPages, textNotIn } from './runtime/context';
import { buildSystemPrompt, buildTaskContext, TASK_CONTEXT } from './planner/systemPrompt';
import { formatSnapshot } from './tools/format';
import { DIFF_HEAD } from './tools/pageDiff';
import { goOnButtons } from './runtime/fillForm';
import { labelBars } from '@/extension/content/snapshot';

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

describe('a tab read before the next one keeps what it showed', () => {
  const tabPage = (tab: string, rows: string[]) => `Page: Smart AI Inbox\nURL: https://inbox.test/\n\nInteractive elements (↓ = outside the visible area):\n${Array.from({ length: 120 }, (_, i) => `[${i}] button "Control ${i}"`).join('\n')}\n\nVisible text (start):\nClinical Summary\n${tab}\n${rows.join('\n')}`;
  it('Medications, then Diagnosis: the medications stay, the controls go', () => {
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'rules' },
      { role: 'user', content: 'medications and history' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'm', name: 'click', arguments: { id: 1 } }, { id: 'd', name: 'click', arguments: { id: 2 } }] },
      { role: 'tool', toolName: 'click', toolCallId: 'm', content: `Clicked "Medications".\n\n${PAGE_AFTER}\n${tabPage('Medications', ['Panadol 500 mg TDS', 'GlucaGen 1 mg'])}` },
      { role: 'tool', toolName: 'click', toolCallId: 'd', content: `Clicked "Diagnosis".\n\n${PAGE_AFTER}\n${tabPage('Diagnosis', ['Diabetes mellitus type 2'])}` },
    ];
    retireEarlierPages(msgs);
    expect(msgs[3].content).toContain('Panadol 500 mg TDS');
    expect(msgs[3].content).toContain('GlucaGen 1 mg');
    expect(msgs[3].content).not.toContain('[5] button'); // the controls went
    expect(msgs[3].content).not.toMatch(/\nClinical Summary\n/); // what the newer read shows too isn't repeated
    expect(textNotIn(msgs[4].content, msgs[4].content)).toBe('');
  });
});

describe('the task’s knowledge and tab, out of the system prompt', () => {
  const base = { agent: { name: 'A', description: '', instructions: '' } as never, toolNames: ['read_page', 'click'], alwaysSkills: [], onDemandSkills: [], readOnly: false, now: new Date(2026, 10, 11) };
  it('the system prompt is the same on every page and for every request', () => {
    const a = buildSystemPrompt({ ...base, page: { title: 'Inbox', url: 'https://a.test/' }, siteKnowledge: '## Knowledge A', contextOutside: true });
    const b = buildSystemPrompt({ ...base, page: { title: 'Dashboard', url: 'https://b.test/' }, siteKnowledge: '## Knowledge B', contextOutside: true });
    expect(a).toBe(b);
    expect(a).not.toContain('Knowledge A');
  });
  it('they come in a message of their own, before the request', () => {
    const text = buildTaskContext({ siteKnowledge: '## Knowledge A', page: { title: 'Inbox', url: 'https://a.test/' }, readOnly: false });
    expect(text.startsWith(TASK_CONTEXT)).toBe(true);
    expect(text).toContain('## Knowledge A');
    expect(text).toContain('Current tab: “Inbox” — https://a.test/');
  });
  it('compaction never cuts it', () => {
    const context: ChatMessage = { role: 'user', content: buildTaskContext({ siteKnowledge: `## Knowledge\n${'a rule. '.repeat(400)}`, page: { title: 'T', url: 'https://a.test/' }, readOnly: false }) };
    const msgs: ChatMessage[] = [{ role: 'system', content: 'rules' }, { role: 'user', content: 'old request' }, { role: 'assistant', content: 'old answer '.repeat(200) }, context, { role: 'user', content: 'go' }, { role: 'tool', toolName: 'read_page', toolCallId: 'r', content: page(1) }];
    compactMessages(msgs, 3_500);
    expect(msgs[3].content).toBe(context.content);
    expect(msgs[2].content.length).toBeLessThan(600);
  });
});

describe('an overview shows a field’s whole value', () => {
  it('a discharge summary written in a comment box is not cut', () => {
    const summary = '[web agent test] DISCHARGE SUMMARY (test data). Admitted 24/10/2026, discharged 27/10/2026 after treatment for pneumonia.';
    const snap = { title: 'Inbox', url: 'https://a.test/', scroll: { atTop: true, atBottom: true, percent: 0, screens: 1 }, frames: [], elements: [{ id: 7, role: 'textbox', name: 'Diagnostic Comment', tag: 'textarea', value: summary, inViewport: true }], omitted: 0, headings: [], text: '' } as never;
    expect(formatSnapshot(snap, 'overview')).toContain(`value="${summary}"`);
  });
});

describe('a Filters bar outside <main> is read', () => {
  it('the Smart Inbox’s bar, once (the outermost), not its menu and not main', () => {
    document.body.innerHTML = `
      <nav><ul><li>Home: x</li><li>Patients: y</li><li>Reports: z</li></ul></nav>
      <section class="panel"><div class="bar">Filters 6 Date range: 11/11/2025 – 11/11/2026 Status: Abnormal File: All Category: Discharge Normal: 0 Abnormal: 1</div></section>
      <div class="list">Arya STARK NHI: ZAA3490</div>
      <main><div>Result Date: 29/10/2026 Provider: Chadmin Category: DISCHARGE</div></main>`;
    const bars = labelBars(document.querySelector('main')!);
    expect(bars).toEqual(['Filters 6 Date range: 11/11/2025 – 11/11/2026 Status: Abnormal File: All Category: Discharge Normal: 0 Abnormal: 1']);
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
    await createClient(provider).chat({ model, messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'knowledge, then the request', cache: true }, { role: 'user', content: 'hi' }], tools: [], temperature: 0 });
    return JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  };

  it('Claude on OpenRouter: the automatic mark, moved to the end by the server', async () => {
    const body = await bodyFor('anthropic/claude-haiku-5.5');
    expect(body.cache_control).toEqual({ type: 'ephemeral' });
    expect(body.messages[0].content[0].cache_control).toEqual({ type: 'ephemeral' }); // the system prompt's, as before
    // The task's knowledge and request: a mark of their own — what comes after them may be put in short.
    expect(body.messages[1].content).toEqual([{ type: 'text', text: 'knowledge, then the request', cache_control: { type: 'ephemeral' } }]);
    expect(body.messages[2].content).toBe('hi');
  });

  it('the task’s own mark is Claude’s only: Gemini takes only its last mark, DeepSeek none', async () => {
    expect((await bodyFor('google/gemini-flash')).messages[1].content).toBe('knowledge, then the request');
    expect((await bodyFor('deepseek/deepseek-v4-flash')).messages[1].content).toBe('knowledge, then the request');
  });

  it('others not: DeepSeek caches by itself, Gemini takes only its last mark', async () => {
    expect((await bodyFor('deepseek/deepseek-v4-flash')).cache_control).toBeUndefined();
    expect((await bodyFor('google/gemini-flash')).cache_control).toBeUndefined();
    expect((await bodyFor('anthropic/claude-haiku-5.5', 'http://localhost:11434/v1')).cache_control).toBeUndefined();
  });
});
