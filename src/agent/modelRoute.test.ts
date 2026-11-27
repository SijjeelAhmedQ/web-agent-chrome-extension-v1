import { describe, expect, it } from 'vitest';
import type { ModelCallRecord } from '@/shared/types/history';
import { describeCalls, describeRoute } from '@/shared/utils/cost';
import { decisionTranscript } from './runtime/agentRun';
import { cheapestOf, choosePrompt, DEFAULT_PICKABLE_MODELS, describePrice, kindOfTask, parsePick } from './runtime/modelRoute';
import { withListedDetails } from './llm/openRouterModels';
import { normalizeConfig } from '@/shared/storage/configStore';

describe('what a request is', () => {
  it.each(['goto patients', 'click search button', 'goto patients and select arya STARK', 'open the inbox', 'patients kholo'])('%s: UI clicks', (request) => {
    expect(kindOfTask(request).kind).toBe('clicks');
  });

  it.each([
    "Show me the trend for this patient's CBC",
    'Show me issues in this mammogram',
    'What are the issues in this discharge summary?',
    'Why is this record abnormal?',
    'give me a summary of arya stark',
    'goto smart AI inbox and open arya Stark patients CBC trend',
  ])('%s: data analysis', (request) => {
    expect(kindOfTask(request).kind).toBe('analysis');
  });

  it.each(['Add a task against this record', 'Add diagnosis against this record', 'Add medication against this record', 'Save selected actions and dismiss the remaining ones', 'summarise it and add a task'])(
    '%s: changes a record',
    (request) => {
      expect(kindOfTask(request).kind).toBe('judged');
    },
  );

  it('leaves to the chooser a reply or anything its words don’t settle', () => {
    expect(kindOfTask('1 and 2')).toEqual({ kind: 'judged' });
    expect(kindOfTask('Arya STARK')).toEqual({ kind: 'judged' });
  });

  it('doesn’t take part of a word for one (“Profile”, “Address”)', () => {
    expect(kindOfTask('open Profile').kind).toBe('clicks');
    expect(kindOfTask('open Address').kind).toBe('clicks');
  });

  it('says which word decided', () => {
    expect(kindOfTask('goto patients').word).toBe('goto');
    expect(kindOfTask('Why is this abnormal').word).toBe('Why');
  });
});

describe('the decision model', () => {
  const list = [
    { id: 'google/gemini-3.8-flash', note: 'analysis', price: { input: 0.825, output: 4.125 }, tools: true },
    { id: '~deepseek/deepseek-flash-latest', price: { input: 0.1, output: 0.4 }, tools: true },
    { id: 'some/no-tools-model', price: { input: 0.01, output: 0.01 }, tools: false },
    { id: 'anthropic/claude-haiku-5.5', price: { input: 1, output: 5 }, tools: true },
  ];

  it('gives clicks to the cheapest model that can click — never one without tools', () => {
    expect(cheapestOf(list)?.id).toBe('~deepseek/deepseek-flash-latest');
    expect(cheapestOf([{ id: 'a' }, { id: 'b' }])?.id).toBe('a');
  });

  it('is told every model with its price and the user’s note — no fixed small, medium, big', () => {
    const prompt = choosePrompt('Add a practice member', list, 'judged');
    for (const m of list) expect(prompt).toContain(m.id);
    expect(prompt).toContain('$0.825 in / $4.125 out per million tokens): analysis');
    expect(prompt).not.toMatch(/SMALL|MEDIUM|BIG/);
  });

  it('takes only a model on the list, by id or by name, whatever is around it', () => {
    expect(parsePick('anthropic/claude-haiku-5.5', list)?.id).toBe('anthropic/claude-haiku-5.5');
    expect(parsePick('**Claude Haiku 5.5** is best here.', list)?.id).toBe('anthropic/claude-haiku-5.5');
    expect(parsePick('deepseek/deepseek-flash-latest', list)?.id).toBe('~deepseek/deepseek-flash-latest');
    expect(parsePick('openai/gpt-9', list)).toBeNull();
    expect(parsePick('', list)).toBeNull();
  });

  it('gets only the request, cut short', () => {
    expect(choosePrompt('x'.repeat(5_000), list, 'judged').length).toBeLessThan(1_800);
  });

  it('says a price it doesn’t know', () => {
    expect(describePrice(undefined)).toBe('price not known');
  });
});

describe('the user’s list of models', () => {
  it('takes price and tools from OpenRouter’s list, and keeps a model it doesn’t list', () => {
    const next = withListedDetails(
      [{ id: 'A/x', note: 'mine' }, { id: 'b/y', price: { input: 9, output: 9 } }],
      [{ id: 'a/x', name: 'X', price: { input: 0.5, output: 2 }, tools: false }],
    );
    expect(next).toEqual([{ id: 'A/x', note: 'mine', price: { input: 0.5, output: 2 }, tools: false }, { id: 'b/y', price: { input: 9, output: 9 } }]);
  });

  it('an older setup: the fixed models become the list, the chooser the decision model', () => {
    const before = normalizeConfig(undefined);
    const id = before.agents[0].id;
    const now = normalizeConfig({
      ...before,
      agents: before.agents.map((a) => (a.id === id ? { ...a, autoModels: { small: '~deepseek/deepseek-flash-latest', medium: 'm/one', big: 'm/one', chooser: 'typesafe/jev-router' } } : a)),
      settings: { ...before.settings, pickableModels: undefined },
    });
    const agent = now.agents.find((a) => a.id === id)!;
    expect(agent.decisionModel).toBe('typesafe/jev-router');
    expect(agent.autoModels).toBeUndefined();
    expect(now.settings.pickableModels?.map((m) => m.id)).toEqual(['~deepseek/deepseek-flash-latest', 'm/one']);
  });

  it('an older decision model (step by step) becomes the decision model; a new setup has none on', () => {
    const before = normalizeConfig(undefined);
    expect(before.agents.every((a) => !a.decisionModel)).toBe(true);
    expect(before.settings.pickableModels).toBeUndefined();
    const id = before.agents[0].id;
    const now = normalizeConfig({ ...before, agents: before.agents.map((a) => (a.id === id ? { ...a, decision: { providerId: null, model: 'typesafe/jev-router' } } : a)) });
    expect(now.agents.find((a) => a.id === id)).toMatchObject({ decisionModel: 'typesafe/jev-router' });
    expect(now.settings.pickableModels).toBeUndefined();
    expect(DEFAULT_PICKABLE_MODELS.length).toBeGreaterThan(1);
  });
});

describe('the log', () => {
  const parts = { system: 0, knowledge: 0, tools: 0, pages: 0, rest: 0 };
  const call = (model: string, role: ModelCallRecord['role'], inputTokens: number, cost: number, tier?: ModelCallRecord['tier']): ModelCallRecord => ({
    at: 1,
    durationMs: 1_000,
    role,
    purpose: 'Doing a step',
    model,
    ...(tier ? { tier } : {}),
    inputTokens,
    outputTokens: 10,
    cost,
    parts,
  });

  it('says clicks got the cheapest model, without the decision model', () => {
    const calls = [call('~deepseek/deepseek-flash-latest', 'worker', 100, 0.001), call('~deepseek/deepseek-flash-latest', 'worker', 200, 0.001)];
    const lines = describeRoute({ kind: 'clicks', word: 'goto', model: '~deepseek/deepseek-flash-latest' }, calls);
    expect(lines[0]).toBe('Small task, only UI clicks (“goto”): the cheapest model on your list (DeepSeek Flash) did it, without asking the decision model.');
    expect(lines[1]).toBe('DeepSeek Flash · ~deepseek/deepseek-flash-latest · 2 calls · 300 in (0 cached) · 20 out · $0.0020');
  });

  it('says who read, who the decision model chose to write, and each part apart', () => {
    const calls = [call('typesafe/jev-router', 'decider', 50, 0.0001), call('~deepseek/deepseek-flash-latest', 'worker', 100, 0.001), call('google/gemini-3.8-flash', 'worker', 500, 0.01)];
    const lines = describeRoute({ kind: 'analysis', word: 'trend', model: 'google/gemini-3.8-flash', reader: '~deepseek/deepseek-flash-latest', chooser: 'typesafe/jev-router' }, calls);
    expect(lines[0]).toMatch(/DeepSeek Flash did the clicks and the reading; the decision model \(Jev Router\) chose Gemini 3.8 Flash to write the analysis/);
    expect(lines.slice(1).map((l) => l.split(' · ')[0])).toEqual(['Decision model', 'DeepSeek Flash', 'Gemini 3.8 Flash']);
  });

  it('says when its answer was not on the list, and when a model got stuck', () => {
    expect(describeRoute({ kind: 'judged', model: 'm/own', fallback: true })[0]).toMatch(/named no model on your list, so the agent's own model \(m\/own\) did it/);
    expect(describeRoute({ kind: 'clicks', model: '~deepseek/deepseek-flash-latest', stuckModel: 'anthropic/claude-haiku-5.5' })[0]).toMatch(/DeepSeek Flash got stuck, so the decision model chose Claude Haiku 5.5 to carry on/);
  });

  it('still reads a task from before the list', () => {
    expect(describeRoute({ kind: 'clicks', tier: 'small', stuckTier: 'medium' })[0]).toMatch(/got stuck, so Jev took over with the medium model/);
    const calls = [call('gemini', 'worker', 500, 0.01, 'big')];
    expect(describeCalls(calls, { kind: 'analysis', tier: 'big' })).toMatch(/1\. Doing a step · Big model gemini/);
    expect(describeRoute(undefined, calls)).toEqual([]);
  });

  it('marks the decision model’s calls', () => {
    expect(describeCalls([call('typesafe/jev-router', 'decider', 50, 0.0001)], { kind: 'judged', model: 'x' })).toMatch(/Choosing|Decision model typesafe\/jev-router/);
  });
});

describe('what the writer of an analysis reads', () => {
  it('ends with its own instruction, and keeps the records whole', () => {
    const records = `Haemoglobin 96 ${'x'.repeat(2_000)}`;
    const text = decisionTranscript(
      [
        { role: 'system', content: 'rules' },
        { role: 'user', content: 'trend' },
        { role: 'assistant', content: '', toolCalls: [{ id: '1', name: 'read_records', arguments: {} }] },
        { role: 'tool', toolCallId: '1', toolName: 'read_records', content: records },
        { role: 'assistant', content: 'READY' },
      ],
      '',
      'Write the answer.',
    );
    expect(text).toContain(records);
    expect(text.endsWith('Write the answer.')).toBe(true);
    expect(text).not.toContain('Decide what the worker does next');
  });
});
