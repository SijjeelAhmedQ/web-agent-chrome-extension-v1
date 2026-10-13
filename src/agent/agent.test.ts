import { describe, expect, it } from 'vitest';
import { defaultConfig } from '@/shared/constants/defaults';
import type { ElementRisk } from '@/shared/types/page';
import { matchesSite } from '@/shared/utils';
import { classifyClick, classifySubmit, classifyTyping } from './execution/riskPolicy';
import { extractTextToolCalls, parseArguments, stripThinking } from './llm/parse';
import { buildSystemPrompt } from './planner/systemPrompt';
import { budgetFor, compactMessages } from './runtime/context';
import { formatElement } from './tools/format';
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
  });
  it('coerces loose arguments from small models', () => {
    const config = defaultConfig();
    const { tools } = buildToolset(config.agents[0], config, 'https://example.com');
    const type = tools.find((t) => t.name === 'type')!;
    expect(type.schema.parse({ id: '12', text: 'hi', submit: 'true' })).toEqual({ id: 12, text: 'hi', clear: true, submit: true });
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
    compactMessages(msgs, 10_000);
    expect(msgs.map((m) => m.content)).toEqual(['s', 'snapshot 0', 'snapshot 1', 'snapshot 2', 'snapshot 3']);
  });
  it('drops all but the latest snapshot once over budget', () => {
    const msgs: ChatMessage[] = [{ role: 'system', content: 's' }];
    for (let i = 0; i < 4; i++) msgs.push({ role: 'tool', toolName: 'read_page', toolCallId: `${i}`, content: `snapshot ${i} `.repeat(100) });
    compactMessages(msgs, 2_000);
    expect(msgs.slice(1, 4).every((m) => /removed/.test(m.content))).toBe(true);
    expect(msgs[4].content).toMatch(/^snapshot 3/);
    expect(budgetFor(12288)).toBeGreaterThan(30_000);
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
