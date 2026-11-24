import { describe, expect, it } from 'vitest';
import type { StepRecord } from '@/shared/types/history';
import { asksUser, followUpOf, historyForModel, looksLikeNewTask, rememberedAnswer } from './runtime/followUp';

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
    // A new task after the question is a fresh start, not a reply — and brings no old checklist along.
    expect(followUpOf(history, 'goto patients and select arya Stark')).toBeNull();
    expect(followUpOf(history, 'add diagnosis Asthma onset 05-05-2026')).toBeNull();
    for (const answer of ['OK', 'routine follow-up', 'Park SA Request', 'the second one', 'yes', 'Cancel'])
      expect(followUpOf(history, answer)).not.toBeNull();
    const shown = historyForModel(history, f);
    expect(shown[1].content.startsWith('(Your last answer — you stopped here to ask the user)')).toBe(true);
  });

  it('takes a second reply (“OK” after “OK”) as a reply to the same task, with its checklist', () => {
    const items = [
      { text: 'Add task: subject "02-Nov-26 Testing" — save', done: true, note: 'saved' },
      { text: 'Add recall: Bloods / CBC — save', done: false, saved: true },
    ];
    const request = 'on Arya STARK’s consult, add a task and a recall';
    const history = [
      { role: 'user' as const, content: request },
      { role: 'assistant' as const, content: rememberedAnswer('The NZF pop-up is open. Which button should I press — OK or Cancel?', steps, items.map((i) => ({ ...i, done: false }))) },
      { role: 'user' as const, content: 'OK' },
      { role: 'assistant' as const, content: rememberedAnswer('2 recalls already exist. Which button should I press — Yes - Add new or Cancel?', steps, items) },
    ];
    const f = followUpOf(history, 'OK');
    expect(f?.task).toBe(request);
    expect(f?.checklist).toEqual(items);
    expect(f?.request).toContain(`Carry on with the task I gave you before (“${request}”)`);
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

describe('a question the task waits on', () => {
  it('is a question offering choices, however politely worded', () => {
    expect(asksUser('The NZF pop-up shows two interactions.\n\nDo you want me to press **OK** or **Cancel**?')).toBe(true);
    expect(asksUser('Two patients match. Would you like me to open Arya STARK or Arya STARKK?')).toBe(true);
  });
  it('is not the open “what would you like to do” after a list is shown — the next command is a new task', () => {
    expect(asksUser('Filtered to **Status: Abnormal**, **Category: Discharge** — Abnormal: 1.\n\nWhat would you like to do with these abnormal records?')).toBe(false);
    expect(asksUser('Arya STARK is open.\n\nWhat would you like to do with her records?')).toBe(false);
    expect(asksUser('You declined File All. How would you like to proceed?')).toBe(false);
    // A question the task needs answered still is one.
    expect(asksUser('Which patient\'s consult would you like to open?')).toBe(true);
    expect(asksUser('Two patients match — which one should I open? Arya STARK or Arya STARKK?')).toBe(true);
    for (const next of ['summarize first record', 'what is this patient\'s medication and medical history', 'file all normal records of arya STARK']) expect(looksLikeNewTask(next)).toBe(true);
    expect(looksLikeNewTask('the first one')).toBe(false);
    expect(looksLikeNewTask('follow up')).toBe(false);
  });

  it('is not a polite offer at the end of a finished task', () => {
    expect(asksUser('The task is saved. Would you like me to do anything else?')).toBe(false);
    expect(asksUser('Done. Is there anything else, or something else I can help with?')).toBe(false);
    expect(asksUser('Saved the task. Let me know if you need anything or want changes?')).toBe(false);
  });
});

describe('what the user said now', () => {
  it('accepts only text the user gave in this message or the site knowledge', async () => {
    const { saidNow } = await import('./runtime/agentRun');
    expect(saidNow('Routine follow-up.', ['routine   follow-up'])).toBe(true);
    expect(saidNow('checking labs', ['reason: “Checking labs” please'])).toBe(true);
    expect(saidNow('routine follow-up', ['goto patients and select Arya Stark', ''])).toBe(false);
    expect(saidNow('i am testing', ['select Arya'], 'Rule: type “i am testing” as the reason')).toBe(true);
    // Words the knowledge merely contains are not a reason the user gave.
    expect(saidNow('Add recall', ['add a recall for Arya'], 'Then click the ⊕ — the Add Recall form opens.')).toBe(false);
  });
});
