import { describe, expect, it } from 'vitest';
import type { StepRecord } from '@/shared/types/history';
import { followUpOf, historyForModel, rememberedAnswer } from './runtime/followUp';

const step = (label: string, note?: string, status: StepRecord['status'] = 'done'): StepRecord => ({ id: label, label, status, tool: 'click', startedAt: 1, ...(note ? { note } : {}) });

const steps = [
  step('Opening “Patients” › “Search & List”', '“Search & List” is showing'),
  step('Typing “Arya Stark” into “Patient Name:”'),
  step('Clicking “Clear”', 'Didn’t work', 'failed'),
  step('Clicking “Arya STARK” (with “03-12-2015”)', 'Opened in a new tab · a dialog is showing'),
];

describe('a reply to the agent’s question', () => {
  it('remembers the steps done when the answer asks the user something', () => {
    const asked = rememberedAnswer('What reason should I add to view the patient file?', steps);
    expect(asked).toContain('1. Opening “Patients” › “Search & List” → “Search & List” is showing');
    expect(asked).toContain('3. Clicking “Arya STARK” (with “03-12-2015”) → Opened in a new tab');
    expect(asked).not.toContain('Clear');
    expect(rememberedAnswer('Arya STARK is open.', steps)).toBe('Arya STARK is open.');
  });

  it('frames the next message as the reply, with the earlier task and the steps not to repeat', () => {
    const history = [
      { role: 'user' as const, content: 'goto patients and select Arya Stark' },
      { role: 'assistant' as const, content: rememberedAnswer('What reason should I add?', steps) },
    ];
    const f = followUpOf(history, 'routine follow-up');
    expect(f?.task).toBe('goto patients and select Arya Stark');
    expect(f?.request).toContain('My reply to your question: “routine follow-up”');
    expect(f?.request).toContain('don\'t start the task over');
    expect(f?.doneSteps).toEqual(['Opening “Patients” › “Search & List”', 'Typing “Arya Stark” into “Patient Name:”', 'Clicking “Arya STARK” (with “03-12-2015”)']);
    const shown = historyForModel(history, f);
    expect(shown[1].content.startsWith('(Your last answer — you stopped here to ask the user)')).toBe(true);
  });

  it('leaves a new request alone', () => {
    const history = [
      { role: 'user' as const, content: 'goto patients and select Arya Stark' },
      { role: 'assistant' as const, content: rememberedAnswer('Arya STARK is open.', steps) },
    ];
    expect(followUpOf(history, 'add medication Metformin')).toBeNull();
    expect(followUpOf([], 'hello')).toBeNull();
    expect(historyForModel(history, null)[1].content.startsWith('(Earlier answer — may be out of date)')).toBe(true);
  });
});
