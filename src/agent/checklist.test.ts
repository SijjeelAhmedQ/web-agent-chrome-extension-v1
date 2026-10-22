import { describe, expect, it } from 'vitest';
import { Checklist, checklistTool } from './runtime/checklist';
import { followUpOf, rememberedAnswer } from './runtime/followUp';
import type { ToolContext } from './tools/types';

const ctx = {} as ToolContext;
const ITEMS = [
  'Medication: gabapentin 100 mg capsule — take 2, twice daily, 5 days, long term',
  'Medication: gabapentin 300 mg capsule — take 3, twice daily, 10 days, long term',
  'Diagnosis: Hypertension — onset 01-05-2026',
  'Diagnosis: Asthma — onset 05-05-2026',
];

describe('the checklist for a request with several things to do', () => {
  it('is made once, ticked item by item, and says what is next', async () => {
    const list = new Checklist();
    const ticked: (number | null)[] = [];
    const tool = checklistTool(list, (d) => ticked.push(d));
    const made = await tool.execute(tool.schema.parse({ items: ITEMS }), ctx);
    expect(made.output).toContain('☐ 1. Medication: gabapentin 100 mg capsule');
    const done = await tool.execute(tool.schema.parse({ done: '1', note: 'added' }), ctx);
    expect(done.output).toContain('☑ 1. Medication: gabapentin 100 mg capsule — take 2, twice daily, 5 days, long term — added');
    expect(done.output).toContain('Next: item 2 — Medication: gabapentin 300 mg');
    expect(ticked).toEqual([null, 1]);
    expect((await tool.execute(tool.schema.parse({ items: ['again'] }), ctx)).output).toContain('already made');
    expect((await tool.execute(tool.schema.parse({ done: 1 }), ctx)).output).toContain('already ticked');
    expect(list.pending()).toEqual([2, 3, 4]);
    expect(list.section()).toContain('Now: item 2');
  });

  it('holds back a tick once when the page shows nothing the item quotes', async () => {
    const shows = new Set(['[web agent test] serial - review bloods']);
    const page = { browser: { send: async (r: { text: string }) => ({ found: shows.has(r.text) }) } } as unknown as ToolContext;
    const list = new Checklist([
      { text: 'Add recall: group Bloods, note "[web agent test] serial recall" — save', done: false, saved: true },
      { text: 'Add task: subject “[web agent test] serial - review bloods” — save', done: false, saved: true },
    ]);
    const tool = checklistTool(list, () => undefined);
    expect((await tool.execute(tool.schema.parse({ done: 1 }), page)).output).toMatch(/^Not ticked yet: the page doesn't show “\[web agent test\] serial recall”/);
    expect(list.pending()).toEqual([1, 2]);
    expect((await tool.execute(tool.schema.parse({ done: 1 }), page)).output).toContain('☑ 1.');
    expect((await tool.execute(tool.schema.parse({ done: 2 }), page)).output).toContain('☑ 2.');
  });

  it('ticks an add only when something was saved for it, or the note says it was there already', async () => {
    const list = new Checklist([
      { text: 'Add diagnosis Essential hypertension, summary "[web agent test] serial 3" — save', done: false },
      { text: 'Add recall: Bloods / CBC — save', done: false },
      { text: 'List the long term diagnoses', done: false },
    ]);
    const tool = checklistTool(list, () => undefined);
    // An older record with the same words is on the page: no proof without a save of its own.
    expect((await tool.execute(tool.schema.parse({ done: 1 }), ctx)).output).toMatch(/^Not ticked: nothing was saved for item 1/);
    list.markSaved();
    expect((await tool.execute(tool.schema.parse({ done: 1 }), ctx)).output).toContain('☑ 1.');
    expect((await tool.execute(tool.schema.parse({ done: 2, note: 'already there — not added' }), ctx)).output).toContain('☑ 2.');
    expect((await tool.execute(tool.schema.parse({ done: 3 }), ctx)).output).toContain('☑ 3.'); // reads nothing to save
  });

  it('remembers across a question that the item in hand was saved', () => {
    const items = [{ text: 'Add recall: Bloods / CBC — save', done: false, saved: true }];
    const asked = rememberedAnswer('2 recalls of CBC already exist. Which button should I press?', [], items);
    const f = followUpOf([{ role: 'user', content: 'add a recall …' }, { role: 'assistant', content: asked }], 'Yes - Add new');
    expect(f?.checklist).toEqual(items);
  });

  it('takes items sent as one string, one per line', () => {
    const tool = checklistTool(new Checklist(), () => undefined);
    expect(tool.schema.parse({ items: '1. Hypertension\n- Asthma\n' }).items).toEqual(['Hypertension', 'Asthma']);
  });

  it('knows what belongs only to a finished item', () => {
    const list = new Checklist(ITEMS.map((text, i) => ({ text, done: i === 0 || i === 2 })));
    expect(list.doneOnly('gabapentin 100 mg')).toBe(1);
    expect(list.doneOnly('Hypertension')).toBe(3);
    expect(list.doneOnly('gabapentin')).toBeNull(); // item 2 needs it too
    expect(list.doneOnly('Asthma')).toBeNull();
    expect(list.doneOnly('2')).toBeNull();
    expect(list.doneOnly('01-05-2026')).toBeNull();
  });

  it('goes along with a question and comes back with the reply', () => {
    const items = ITEMS.map((text, i) => ({ text, done: i === 0, ...(i === 0 ? { note: 'added' } : {}) }));
    const asked = rememberedAnswer('Which frequency for gabapentin 300 mg — twice daily or three times daily?', [], items);
    const f = followUpOf([{ role: 'user', content: 'add medications …' }, { role: 'assistant', content: asked }], 'twice daily');
    expect(f?.checklist).toEqual(items);
    expect(f?.doneSteps).toEqual([]);
  });
});

describe('a wrong click in the row of the record the user named', () => {
  it('is an icon or unlabeled control there, unless the user asked for what it does', async () => {
    const { wrongRowClick } = await import('./runtime/clickGuard');
    const row = 'row 3 “Arya STARK · 03-12-2015 · ZAA3490”';
    const ask = 'goto patients and select arya STARK';
    expect(wrongRowClick(ask, { name: 'Book appointment (icon)', role: 'image', context: row })).toEqual({ item: 'Arya STARK', control: 'Book appointment (icon)' });
    expect(wrongRowClick(ask, { name: '', role: 'clickable', context: row })?.control).toBe('a control with no label');
    expect(wrongRowClick(ask, { name: 'Arya STARK', role: 'link', context: row })).toBeNull();
    expect(wrongRowClick('book appointment for arya stark', { name: 'Book appointment (icon)', role: 'image', context: row })).toBeNull();
    expect(wrongRowClick('goto patients and select kook jung', { name: 'Book appointment (icon)', role: 'image', context: row })).toBeNull();
    expect(wrongRowClick(ask, { name: 'Select', role: 'checkbox', context: row })).toBeNull();
    expect(wrongRowClick(ask, { name: 'Edit', role: 'image', context: 'form “Patient”' })).toBeNull();
  });
});
