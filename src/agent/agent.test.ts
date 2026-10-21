import { describe, expect, it } from 'vitest';
import { defaultConfig } from '@/shared/constants/defaults';
import type { ElementRisk } from '@/shared/types/page';
import { matchesSite } from '@/shared/utils';
import { classifyClick, classifySubmit, classifyTyping } from './execution/riskPolicy';
import { extractTextToolCalls, parseArguments, stripThinking } from './llm/parse';
import { buildSystemPrompt } from './planner/systemPrompt';
import { budgetFor, compactMessages, estimateTokens, shrinkSnapshot } from './runtime/context';
import { namedIn, quotesIn, talksAboutPage } from './runtime/agentRun';
import { formatElement, formatSnapshot } from './tools/format';
import { buildToolset, toolSpecs } from './tools/registry';
import type { ChatMessage } from './llm/types';

const risk = (over: Partial<ElementRisk>): ElementRisk => ({
  name: '',
  role: 'button',
  tag: 'button',
  formHasPassword: false,
  formHasPayment: false,
  formIsSearch: false,
  formSubmitLabels: [],
  ...over,
});

describe('matchesSite', () => {
  it('matches a domain and its subdomains', () => {
    expect(matchesSite('https://www.amazon.com/dp/1', ['amazon.com'])).toBe(true);
    expect(matchesSite('https://smile.amazon.com/', ['amazon.com'])).toBe(true);
    expect(matchesSite('https://notamazon.com/', ['amazon.com'])).toBe(false);
  });
  it('supports wildcards, ports and paths', () => {
    expect(matchesSite('https://a.example.com/', ['*.example.com'])).toBe(true);
    expect(matchesSite('https://example.com/', ['*.example.com'])).toBe(false);
    expect(matchesSite('http://localhost:5173/summary', ['localhost:5173'])).toBe(true);
    expect(matchesSite('http://localhost:3000/', ['localhost:5173'])).toBe(false);
    expect(matchesSite('https://example.com/admin/users', ['example.com/admin'])).toBe(true);
    expect(matchesSite('https://example.com/shop', ['example.com/admin'])).toBe(false);
    expect(matchesSite('https://mybank.com/', ['https://mybank.com/'])).toBe(true);
  });
  it('ignores junk', () => {
    expect(matchesSite('chrome://newtab', ['newtab'])).toBe(false);
    expect(matchesSite('https://a.com', ['', '  '])).toBe(false);
  });
});

describe('risk policy', () => {
  it('flags purchases, sends and deletions', () => {
    expect(classifyClick(risk({ name: 'Place your order' })).consequential).toBe(true);
    expect(classifyClick(risk({ name: 'Buy now' })).consequence).toBe('make a purchase or payment');
    expect(classifyClick(risk({ name: 'Send' })).consequential).toBe(true);
    expect(classifyClick(risk({ name: 'Delete patient' })).consequence).toBe('delete something');
    expect(classifyClick(risk({ name: 'Save' })).consequential).toBe(true);
  });
  it('asks before completing or filing records, and before a confirm’s Yes', () => {
    expect(classifyClick(risk({ name: 'Complete' })).consequence).toBe('complete or file a record');
    expect(classifyClick(risk({ name: 'File' })).consequential).toBe(true);
    expect(classifyClick(risk({ name: 'Yes', dialogText: 'Are you sure you want to complete the selected task(s)? Yes No' })).consequence).toBe('complete or file a record');
    expect(classifyClick(risk({ name: 'Yes', dialogText: 'Do you want to see more results? Yes No' })).consequential).toBe(false);
    expect(classifyClick(risk({ name: 'Profile' })).consequential).toBe(false);
    expect(classifyClick(risk({ name: 'Inactive', role: 'image', tag: 'img' })).consequence).toBe('cancel or deactivate a record');
    expect(classifyClick(risk({ name: 'Click to cancel recall' })).consequential).toBe(true);
    expect(classifyClick(risk({ name: 'Cancel' })).consequential).toBe(false);
  });
  it('leaves ordinary navigation alone', () => {
    expect(classifyClick(risk({ name: 'Search' })).consequential).toBe(false);
    expect(classifyClick(risk({ name: 'Next page' })).consequential).toBe(false);
    expect(classifyClick(risk({ name: 'Accept all cookies' })).consequential).toBe(false);
    expect(classifyClick(risk({ name: 'Posts', role: 'link', tag: 'a' })).consequential).toBe(false);
    expect(classifyClick(risk({ name: 'Send feedback', role: 'link', tag: 'a' })).consequential).toBe(false);
  });
  it('still flags dangerous links', () => {
    expect(classifyClick(risk({ name: 'Delete account', role: 'link', tag: 'a' })).consequential).toBe(true);
  });
  it('judges form submission by the form', () => {
    expect(classifySubmit(risk({ formIsSearch: true, formSubmitLabels: ['Submit'] })).consequential).toBe(false);
    expect(classifySubmit(risk({ formHasPassword: true })).consequential).toBe(true);
    expect(classifySubmit(risk({ formSubmitLabels: ['Save changes'] })).consequential).toBe(true);
    expect(classifySubmit(risk({ formSubmitLabels: ['Go'] })).consequential).toBe(false);
  });
  it('asks before typing secrets', () => {
    expect(classifyTyping(risk({ type: 'password', role: 'textbox', tag: 'input' })).consequential).toBe(true);
    expect(classifyTyping(risk({ name: 'Card number', role: 'textbox', tag: 'input' })).consequential).toBe(true);
    expect(classifyTyping(risk({ name: 'First name', role: 'textbox', tag: 'input' })).consequential).toBe(false);
  });
});

describe('model output parsing', () => {
  it('repairs sloppy JSON arguments', () => {
    expect(parseArguments('{"id": 3,}').value).toEqual({ id: 3 });
    expect(parseArguments('```json\n{"id": 4}\n```').value).toEqual({ id: 4 });
    expect(parseArguments({ id: 5 }).value).toEqual({ id: 5 });
    expect(parseArguments('nonsense').error).toBeTruthy();
  });
  it('recovers tool calls written as text', () => {
    const known = new Set(['click', 'read_page']);
    const tagged = extractTextToolCalls('Sure.<tool_call>{"name":"click","arguments":{"id":7}}</tool_call>', known);
    expect(tagged.calls).toHaveLength(1);
    expect(tagged.calls[0]).toMatchObject({ name: 'click', arguments: { id: 7 } });
    expect(tagged.rest).toBe('Sure.');
    expect(extractTextToolCalls('{"name":"read_page","arguments":{}}', known).calls[0].name).toBe('read_page');
    expect(extractTextToolCalls('{"name":"rm_rf","arguments":{}}', known).calls).toHaveLength(0);
  });
  it('strips reasoning', () => {
    expect(stripThinking('<think>hmm</think>\nDone.')).toBe('Done.');
  });
});

describe('toolset', () => {
  it('builds valid JSON schemas for every built-in tool', () => {
    const config = defaultConfig();
    const { tools } = buildToolset(config.agents[0], config, 'https://example.com');
    const specs = toolSpecs(tools);
    expect(specs.map((s) => s.name)).toContain('load_skill');
    for (const spec of specs) {
      expect(spec.parameters.type).toBe('object');
      expect(spec.parameters).not.toHaveProperty('$schema');
    }
    const click = specs.find((s) => s.name === 'click')!;
    expect((click.parameters.required as string[]) ?? []).toContain('id');
    // Text inputs the tool can't work without are marked required (not just coerced).
    const required = (name: string) => (specs.find((s) => s.name === name)!.parameters.required as string[]) ?? [];
    expect(required('type')).toEqual(expect.arrayContaining(['id', 'text']));
    expect(required('click_text')).toEqual(['text']);
    expect(required('select_option')).toEqual(expect.arrayContaining(['id', 'option']));
    const typeTool = tools.find((t) => t.name === 'type')!;
    expect(typeTool.schema.safeParse({ id: 3 }).success).toBe(false);
    expect(typeTool.schema.parse({ id: 3, text: 42 })).toMatchObject({ text: '42' });
  });
  it('coerces loose arguments from small models', () => {
    const config = defaultConfig();
    const { tools } = buildToolset(config.agents[0], config, 'https://example.com');
    const type = tools.find((t) => t.name === 'type')!;
    expect(type.schema.parse({ id: '12', text: 'hi', submit: 'true' })).toEqual({ id: 12, text: 'hi', clear: true, submit: true });
  });
  it('sends the user’s edits of a built-in tool to the model', () => {
    const config = defaultConfig();
    config.settings.toolOverrides = { click_text: { description: 'Click visible text. On our PMS, click the patient name.', params: { near: 'The date of birth in that row' }, alwaysAsk: true } };
    const { tools } = buildToolset(config.agents[0], config, 'https://x.com');
    const spec = toolSpecs(tools).find((s) => s.name === 'click_text')!;
    expect(spec.description).toBe('Click visible text. On our PMS, click the patient name.');
    const props = (spec.parameters as { properties: Record<string, { description?: string }> }).properties;
    expect(props.near.description).toBe('The date of birth in that row');
    expect(props.text.description).toMatch(/visible text/);
    expect(tools.find((t) => t.name === 'click_text')!.alwaysAsk).toBe(true);
    // Untouched tools are sent as they are.
    expect(tools.find((t) => t.name === 'click')!.alwaysAsk).toBeUndefined();
  });
  it('respects assignments, global switches and site-scoped skills', () => {
    const config = defaultConfig();
    config.settings.disabledToolIds = ['click'];
    config.skills[0].sites = ['careflow.local'];
    const reader = config.agents[1];
    const names = buildToolset(reader, config, 'https://x.com').tools.map((t) => t.name);
    expect(names).not.toContain('type');
    expect(buildToolset(config.agents[0], config, 'https://x.com').tools.map((t) => t.name)).not.toContain('click');
    expect(buildToolset(config.agents[0], config, 'https://x.com').onDemandSkills.map((s) => s.id)).not.toContain(config.skills[0].id);
    expect(buildToolset(config.agents[0], config, 'https://careflow.local/a').onDemandSkills.map((s) => s.id)).toContain(config.skills[0].id);
  });
});

describe('prompt and context', () => {
  it('includes agent instructions, skills and page context', () => {
    const config = defaultConfig();
    const prompt = buildSystemPrompt({
      agent: { ...config.agents[0], instructions: 'Prefer tables.' },
      toolNames: ['read_page', 'click', 'type'],
      alwaysSkills: [{ ...config.skills[0], activation: 'always' }],
      onDemandSkills: [config.skills[1]],
      page: { title: 'Shop', url: 'https://shop.test/' },
      readOnly: true,
    });
    expect(prompt).toContain('Prefer tables.');
    expect(prompt).toContain(config.skills[0].instructions.split('\n')[0]);
    expect(prompt).toContain(`"${config.skills[1].name}"`);
    expect(prompt).toContain('https://shop.test/');
    expect(prompt).toContain('read-only');
  });
  it('leaves the prompt untouched while it fits (prompt-cache friendly)', () => {
    const msgs: ChatMessage[] = [{ role: 'system', content: 's' }];
    for (let i = 0; i < 4; i++) msgs.push({ role: 'tool', toolName: 'read_page', toolCallId: `${i}`, content: `snapshot ${i}` });
    compactMessages(msgs, 3_000);
    expect(msgs.map((m) => m.content)).toEqual(['s', 'snapshot 0', 'snapshot 1', 'snapshot 2', 'snapshot 3']);
  });
  it('drops all but the latest snapshot once over budget', () => {
    const msgs: ChatMessage[] = [{ role: 'system', content: 's' }];
    for (let i = 0; i < 4; i++) msgs.push({ role: 'tool', toolName: 'read_page', toolCallId: `${i}`, content: `snapshot ${i} `.repeat(100) });
    compactMessages(msgs, 1_000);
    expect(msgs.slice(1, 4).every((m) => /removed/.test(m.content))).toBe(true);
    expect(msgs[4].content).toMatch(/^snapshot 3/);
    expect(budgetFor(16384)).toBe(14_884);
  });
  it('always fits the budget: chat history is trimmed, then the latest page shrinks — text first, then off-screen elements', () => {
    const els = Array.from({ length: 240 }, (_, i) => `[${7400 + i}] link "Patient ${i}" in row "03-12-2015 · ZAA3490"${i > 120 ? ' ↓' : ''}`);
    const page = `Page: Patient Search\nURL: https://x.test/\n\nInteractive elements (↓ = outside the visible area):\n${els.join('\n')}\n\nVisible text (start):\n${'Arya STARK 03-12-2015 +642100000000 '.repeat(300)}`;
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'rules '.repeat(3000) },
      { role: 'user', content: 'earlier request' },
      { role: 'assistant', content: 'a long earlier answer with a table '.repeat(200) },
      { role: 'user', content: 'goto patients and select arya stark' },
      { role: 'tool', toolName: 'read_page', toolCallId: '1', content: page },
    ];
    compactMessages(msgs, 9_000);
    const total = msgs.reduce((n, m) => n + estimateTokens(m.content) + 4, 0);
    expect(total).toBeLessThanOrEqual(9_000);
    expect(msgs[3].content).toBe('goto patients and select arya stark');
    expect(msgs[2].content.length).toBeLessThan(600);
    expect(msgs[4].content).not.toContain('Visible text');
    expect(msgs[4].content).toContain('[7400] link "Patient 0"');
    expect(msgs[4].content).toMatch(/shortened to fit/);
  });
  it('keeps the pop-up’s own text when a long page is shortened', () => {
    const els = Array.from({ length: 400 }, (_, i) => `[${7400 + i}] link "Item ${i}" in row "03-12-2015 · ZAA3490"`);
    const page = `Page: Consult Detail\nURL: https://x.test/\nPop-ups showing on top of the page:\n- "NZF" — can be closed: [1] button "×". Shows: "NZF"\nAll the text of the pop-up “NZF”:\ncodeine (systemic) and gabapentin (systemic) — Monitor for signs of CNS depression — Moderate\n\nInteractive elements (↓ = outside the visible area):\n${els.join('\n')}\n\nPage text:\n${'text '.repeat(3000)}`;
    const out = shrinkSnapshot(page, 2_000);
    expect(out).toContain('codeine (systemic) and gabapentin (systemic) — Monitor for signs of CNS depression — Moderate');
    expect(estimateTokens(out)).toBeLessThanOrEqual(2_100);
  });
  it('estimates more tokens for digits', () => {
    expect(estimateTokens('2026-10-15')).toBeGreaterThan(estimateTokens('abcdefghij'));
  });
  it('knows when the request names the item being picked', () => {
    expect(namedIn('goto patients and select arya stark', 'Arya STARK')).toBe(true);
    expect(namedIn('open the first patient', 'Arya STARK')).toBe(false);
    expect(namedIn('select Patient 1', 'Patient 1')).toBe(true);
  });
  it('sends an answer about the page back when the page was never read', () => {
    expect(talksAboutPage("You're already on Arya STARK's consult (DOB 03-12-2015).")).toBe(true);
    expect(talksAboutPage('Hello! How can I help?')).toBe(false);
  });
  it('finds the page text an answer quotes — a few words, not a single name', () => {
    expect(quotesIn('The list shows "No new messages." and the button “Click here to load the data from archive.”')).toEqual(['No new messages.', 'Click here to load the data from archive.']);
    expect(quotesIn('Click "Lab" or "OK".')).toEqual([]);
  });
  it('names a table row once: the other elements of the row say “(same row)”', () => {
    const row = 'row 2 “Arya STARK · 03-12-2015”';
    const els = [
      { id: 1, role: 'link', name: 'Arya STARK', tag: 'a', inViewport: true, context: row },
      { id: 2, role: 'image', name: 'Edit', tag: 'img', inViewport: true, context: row },
      { id: 3, role: 'image', name: 'Task', tag: 'img', inViewport: true, context: row },
      { id: 4, role: 'link', name: 'Kook JUNG', tag: 'a', inViewport: true, context: 'row 3 “Kook JUNG · 01-09-2000”' },
    ];
    const out = formatSnapshot({ title: 'Patient Search', url: 'https://x.test/', scroll: { atTop: true, atBottom: true, percent: 0, screens: 1 }, elements: els, omitted: 0, frames: [], headings: [], text: '', textTruncated: false, dialogOpen: false } as never, 'overview');
    expect(out).toContain('[1] link "Arya STARK" in row 2 “Arya STARK · 03-12-2015”');
    expect(out).toContain('[2] image "Edit" (same row)');
    expect(out).toContain('[3] image "Task" (same row)');
    expect(out).toContain('[4] link "Kook JUNG" in row 3');
    expect(formatElement(els[1] as never)).toBe('[2] image "Edit" in row 2 “Arya STARK · 03-12-2015”');
  });
  it('formats elements compactly', () => {
    expect(formatElement({ id: 3, role: 'searchbox', name: 'Search', tag: 'input', type: 'search', value: '', inViewport: true })).toBe('[3] searchbox "Search" (empty)');
    expect(formatElement({ id: 9, role: 'button', name: 'Add', tag: 'button', disabled: true, context: 'row 2 “Aspirin”', inViewport: false })).toBe('[9] button "Add" (disabled) in row 2 “Aspirin” ↓');
  });
});

describe('double-check before answering', () => {
  it('spots answers that claim something was done', async () => {
    const { claimsDone } = await import('./runtime/agentRun');
    expect(claimsDone('I selected Luke King (MRN-100076).')).toBe(true);
    expect(claimsDone('Saved the medication.')).toBe(true);
    expect(claimsDone('Luke King is now the selected patient.')).toBe(true);
    expect(claimsDone('The page lists three patients: Tom Baker, Chloe Bell and Sophie Brown.')).toBe(false);
    expect(claimsDone('Which patient do you mean?')).toBe(false);
  });
});

describe('unfinished replies', () => {
  it('spots narration of a next step and replies cut mid-sentence', async () => {
    const { soundsUnfinished } = await import('./runtime/agentRun');
    // From the user's log: cut off by the context limit.
    expect(soundsUnfinished('Good, the frequency dropdown is now open. I can see "Twice daily" as an option (element [234]). Let')).toBe(true);
    expect(soundsUnfinished('The dropdown is open. Let me click “Twice daily”.')).toBe(true);
    expect(soundsUnfinished('Now I need to fill in the dosage.')).toBe(true);
    // Real final answers.
    expect(soundsUnfinished('Added Panadol 500 mg, twice daily for 10 days.')).toBe(false);
    expect(soundsUnfinished('Done. Let me know if you need anything else.')).toBe(false);
    expect(soundsUnfinished('| Laptop | Price |\n|---|---|\n| Aero 14 | $649 |')).toBe(false);
  });
});

describe('declined steps', () => {
  it('explains plainly what was not done', async () => {
    const { declinedAnswer } = await import('./runtime/agentRun');
    expect(declinedAnswer('Click “Save Medication”?')).toMatch(/^Stopped — you cancelled “Save Medication”, so it wasn’t done\./);
    expect(declinedAnswer('Submit this form?')).toMatch(/you cancelled “Submit this form”/);
  });
});

describe('tool schemas the providers accept', () => {
  it('has no OpenAPI-style boolean bounds (DeepSeek could not call click or type with them)', async () => {
    const { BROWSER_TOOLS } = await import('./tools/browserTools');
    const { specOf } = await import('./tools/registry');
    const specs = JSON.stringify(BROWSER_TOOLS.map(specOf));
    expect(specs).not.toMatch(/"exclusive(Minimum|Maximum)":(true|false)/);
    expect(specs).not.toMatch(/"nullable":/);
  });
});

describe('the wrong-row guard and words for the same action', () => {
  it('lets “delete the HBA1C recall” press that row’s Inactive icon', async () => {
    const { wrongRowClick } = await import('./runtime/clickGuard');
    const inactive = { name: 'Inactive', role: 'image', context: 'row 14 “HBA1C · [web agent test] HbA1c recall · 6 Day(s)”' };
    expect(wrongRowClick('delete Arya’s recall HBA1C', inactive)).toBeNull();
    expect(wrongRowClick('open the HBA1C recall', inactive)).not.toBeNull();
  });
});
