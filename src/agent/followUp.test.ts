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
    expect(rememberedAnswer('Arya STARK is open. Is there anything else I can help you with?', steps)).not.toContain('Where I stopped');
    expect(rememberedAnswer('Done. Would you like me to add a medication?', steps)).not.toContain('Where I stopped');
    expect(rememberedAnswer("Arya STARK's consult is open. Is there anything you'd like me to do with this patient's record?", steps)).not.toContain('Where I stopped');
    expect(rememberedAnswer('Which one should I open — Arya STARK (03-12-2015) or Arya STARK (01-01-1990)?', steps)).toContain('Where I stopped');
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
    expect(followUpOf(history, 'goto patients and select Arya Stark')).toBeNull();
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

describe('what the user said now', () => {
  it('accepts only text the user gave in this message or the site knowledge', async () => {
    const { saidNow } = await import('./runtime/agentRun');
    expect(saidNow('Routine follow-up.', ['routine   follow-up'])).toBe(true);
    expect(saidNow('checking labs', ['reason: “Checking labs” please'])).toBe(true);
    expect(saidNow('routine follow-up', ['goto patients and select Arya Stark', ''])).toBe(false);
    expect(saidNow('i am testing', ['select Arya', 'Rule: type “i am testing” as the reason'])).toBe(true);
  });
});
