import { describe, expect, it } from 'vitest';
import { fieldCall, fillFormSchema, stopsFilling } from './runtime/fillForm';

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
