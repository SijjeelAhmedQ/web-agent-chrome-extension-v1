import { describe, expect, it } from 'vitest';
import type { ModelCallRecord } from '@/shared/types/history';
import { describeCalls, describeRoute } from '@/shared/utils/cost';
import { decisionTranscript } from './runtime/agentRun';
import { choosePrompt, DEFAULT_AUTO_MODELS, fallbackTier, kindOfTask, parseTier, tierOfModel, tiersFor } from './runtime/modelRoute';

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

describe('the chooser', () => {
  it('never gives analysis to the small model', () => {
    expect(tiersFor('analysis')).toEqual(['medium', 'big']);
    expect(parseTier('SMALL', tiersFor('analysis'))).toBeNull();
    expect(choosePrompt('summary', tiersFor('analysis'))).not.toMatch(/SMALL/);
  });

  it('reads its one word, whatever is around it', () => {
    expect(parseTier('BIG', ['small', 'medium', 'big'])).toBe('big');
    expect(parseTier('**Medium**.', ['small', 'medium', 'big'])).toBe('medium');
    expect(parseTier('I think so', ['small', 'medium', 'big'])).toBeNull();
  });

  it('falls back to a model that can do the job', () => {
    expect(fallbackTier('analysis')).toBe('big');
    expect(fallbackTier('judged')).toBe('medium');
  });

  it('gets only the request, cut short', () => {
    const prompt = choosePrompt('x'.repeat(5_000), tiersFor('judged'));
    expect(prompt.length).toBeLessThan(900);
  });
});

describe('the log', () => {
  const parts = { system: 0, knowledge: 0, tools: 0, pages: 0, rest: 0 };
  const call = (model: string, tier: ModelCallRecord['tier'], inputTokens: number, cost: number): ModelCallRecord => ({ at: 1, durationMs: 1_000, role: 'worker', purpose: 'Doing a step', model, tier, inputTokens, outputTokens: 10, cost, parts });

  it('says a small task got the small model, its tokens and cost', () => {
    const calls = [call('deepseek', 'small', 100, 0.001), call('deepseek', 'small', 200, 0.001)];
    const lines = describeRoute({ kind: 'clicks', word: 'goto', tier: 'small' }, calls);
    expect(lines[0]).toMatch(/Small task, only UI clicks \(“goto”\): the small model did it, without Jev/);
    expect(lines[1]).toBe('Small model · deepseek · 2 calls · 300 in (0 cached) · 20 out · $0.0020');
  });

  it('says analysis got the big model, and each part apart', () => {
    const calls = [call('jev', 'chooser', 50, 0.0001), call('deepseek', 'small', 100, 0.001), call('gemini', 'big', 500, 0.01)];
    const lines = describeRoute({ kind: 'analysis', word: 'trend', tier: 'big' }, calls);
    expect(lines[0]).toMatch(/Jev chose the big model to write the analysis/);
    expect(lines.slice(1).map((l) => l.split(' · ')[0])).toEqual(['Small model', 'Big model', 'Jev']);
  });

  it('says when the small model got stuck', () => {
    expect(describeRoute({ kind: 'clicks', tier: 'small', stuckTier: 'medium' })[0]).toMatch(/got stuck, so Jev took over with the medium model/);
  });

  it('marks each call, and shows nothing new without a route', () => {
    const calls = [call('gemini', 'big', 500, 0.01)];
    expect(describeCalls(calls, { kind: 'analysis', tier: 'big' })).toMatch(/1\. Doing a step · Big model gemini/);
    expect(describeRoute(undefined, calls)).toEqual([]);
  });

  it('names each model’s part', () => {
    expect(tierOfModel(DEFAULT_AUTO_MODELS, DEFAULT_AUTO_MODELS.small)).toBe('small');
    expect(tierOfModel(DEFAULT_AUTO_MODELS, DEFAULT_AUTO_MODELS.chooser)).toBe('chooser');
    expect(tierOfModel(DEFAULT_AUTO_MODELS, 'other')).toBeUndefined();
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
