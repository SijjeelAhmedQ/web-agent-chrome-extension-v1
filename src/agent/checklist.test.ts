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
