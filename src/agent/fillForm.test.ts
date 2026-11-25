import { describe, expect, it } from 'vitest';
import { formFilled } from './tools/browserTools';
import type { ToolContext } from './tools/types';
import { fieldCall, fieldGroup, fillFormSchema, stopsFilling } from './runtime/fillForm';

describe('fill_form', () => {
  it('makes each field its own type or select_option step', () => {
    const { fields } = fillFormSchema.parse({ fields: [{ id: 3321, text: '1' }, { id: 3325, option: 'TDS' }] });
    expect(fieldCall(fields[0], 0, 'c1')).toEqual({ id: 'c1_0', name: 'type', arguments: { id: 3321, text: '1' } });
    expect(fieldCall(fields[1], 1, 'c1')).toEqual({ id: 'c1_1', name: 'select_option', arguments: { id: 3325, option: 'TDS' } });
  });

  it('takes text or an option for a field, not both or neither', () => {
    expect(fillFormSchema.safeParse({ fields: [{ id: 1, text: 'a', option: 'b' }] }).success).toBe(false);
    expect(fillFormSchema.safeParse({ fields: [{ id: 1 }] }).success).toBe(false);
    expect(fillFormSchema.safeParse({ fields: [] }).success).toBe(false);
  });

  it('stops at a field that was refused or waits for a suggestion', () => {
    expect(stopsFilling('Not typed: “Add reason to view patient file” is a pop-up that can’t be closed…')).toBe(true);
    expect(stopsFilling('Typed into “Due-in”. It now contains: “2”. A list of suggestions opened under it: “2 Week(s)”.')).toBe(true);
    expect(stopsFilling('Typed into “Take”. It now contains: “1”.')).toBe(false);
  });
});

describe('several fields in one reply', () => {
  const call = (name: string, args: Record<string, unknown>, id = name) => ({ id, name, arguments: args });

  it('are filled as fill_form fills them: the longest run of calls that only fill a field', () => {
    const calls = [call('click', { id: 1 }), call('type', { id: 10, text: 'Token' }), call('type', { id: 11, text: 'Bench' }), call('select_option', { id: 12, option: 'Female' }), call('click', { id: 20 })];
    expect(fieldGroup(calls)).toEqual({ from: 1, to: 3, firstId: 10, given: ['Token', 'Bench', 'Female'] });
  });

  it('not one field alone, nor a field that presses Enter or a button after (that step goes on)', () => {
    expect(fieldGroup([call('type', { id: 10, text: 'a' })])).toBeNull();
    expect(fieldGroup([call('type', { id: 10, text: 'a' }), call('type', { id: 11, text: 'b', submit: true })])).toBeNull();
    expect(fieldGroup([call('type', { id: 10, text: 'a', then_click: 5 }), call('type', { id: 11, text: 'b' })])).toBeNull();
  });

  it('after them, says once what the page rewrote itself — not the fields that hold what was put in', async () => {
    const reads = [
      { self: 'First', values: [{ label: 'First', value: '' }, { label: 'Last', value: '' }, { label: 'Directions', value: 'Take 1' }] },
      { self: 'First', values: [{ label: 'First', value: 'Token' }, { label: 'Last', value: 'Bench' }, { label: 'Directions', value: 'Take 2 daily' }] },
    ];
    const ctx = { browser: { send: async (r: { kind: string }) => (r.kind === 'formAround' ? reads.shift() : null) } } as unknown as ToolContext;
    const before = (await ctx.browser.send({ kind: 'formAround', id: 1 } as never)) as never;
    const out = await formFilled(ctx, 1, before, ['Token', 'Bench']);
    expect(out).toBe('The page also changed “Directions” from “Take 1” to “Take 2 daily”. If the user gave a value for it, set it again now.');
  });
});
