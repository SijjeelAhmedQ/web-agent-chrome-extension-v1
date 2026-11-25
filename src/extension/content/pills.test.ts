import { describe, expect, it } from 'vitest';
import { pickerOf, pickerState } from './form';

// OctansCare's Preferred contact, as the page has it: an Ant form item around a Mantine PillsInput, SMS and Email chosen.
const FIELD = `<div class="ant-form-item"><div class="ant-form-item-label"><label>Preferred contact</label></div>
  <div class="ant-form-item-control-input-content"><div class="m_46b77525 mantine-InputWrapper-root mantine-PillsInput-root"><div class="mantine-Input-wrapper mantine-PillsInput-wrapper"><div class="mantine-Input-input mantine-PillsInput-input"><div class="mantine-PillGroup-group">
    <span class="mantine-Pill-root" data-with-remove="true"><span class="m_1e0e6180 mantine-Pill-label">SMS</span><button class="mantine-Pill-remove" type="button" aria-hidden="true"></button></span>
    <span class="mantine-Pill-root" data-with-remove="true"><span class="m_1e0e6180 mantine-Pill-label">Email</span><button class="mantine-Pill-remove" type="button" aria-hidden="true"></button></span>
    <input class="mantine-PillsInputField-field" aria-haspopup="listbox" type="text" value="">
  </div></div></div></div></div></div>`;

describe('a field that holds several, drawn as pills (Mantine)', () => {
  it('is a picker that can hold several, holding what its pills say', () => {
    document.body.innerHTML = FIELD;
    // jsdom lays nothing out: every element counts as shown.
    for (const e of Array.from(document.querySelectorAll('*'))) (e as HTMLElement).getBoundingClientRect = () => ({ width: 40, height: 20, top: 0, left: 0, right: 40, bottom: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    for (const e of Array.from(document.querySelectorAll('*'))) (e as HTMLElement & { checkVisibility: () => boolean }).checkVisibility = () => true;
    const input = document.querySelector('input')!;
    expect(pickerOf(input)?.className).toContain('mantine-PillsInput-root');
    expect(pickerState(input)).toMatchObject({ several: true, chosen: ['SMS', 'Email'] });
  });
});
