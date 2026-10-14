import { describe, expect, it } from 'vitest';
import { accessibleName } from '@/extension/content/elements';
import { knowledgeBudget, knowledgeSection } from './planner/siteKnowledge';
import { BROWSER_TOOLS } from './tools/browserTools';
import { ElementMemory, type ToolContext } from './tools/types';

const nameOf = (html: string, selector: string) => {
  document.body.innerHTML = html;
  return accessibleName(document.querySelector(selector)!);
};

describe('field names in older, table-based forms', () => {
  const form = `
    <table>
      <tr><td>Take:</td><td><input id="txtTake"></td><td>Frequency: *</td><td><select id="ddlFreq"><option>--Select--</option></select></td></tr>
      <tr><td>Duration: *</td><td><input id="txtDur"> <select id="ddlDurType"><option>Day/s</option></select></td></tr>
      <tr><td><label>Patient Name:</label></td><td><input id="pn" placeholder="Surname First Name"></td></tr>
      <tr><td></td><td><input id="lonely" name="txtLonely"></td></tr>
    </table>`;
  it('takes the label from the cell before the field', () => {
    expect(nameOf(form, '#txtTake')).toBe('Take');
    expect(nameOf(form, '#ddlFreq')).toBe('Frequency');
    expect(nameOf(form, '#txtDur')).toBe('Duration');
    expect(nameOf(form, '#ddlDurType')).toBe('Duration');
    // A real label beats the placeholder; the placeholder is still shown separately.
    expect(nameOf(form, '#pn')).toBe('Patient Name');
    // No label anywhere: the old fallback (its name attribute).
    expect(nameOf(form, '#lonely')).toBe('txtLonely');
  });

  it('takes the label from the box before the field in column layouts', () => {
    const grid = `<div class="row"><div><span>Find Medicine:</span></div><div><input id="MedicineNameSearch"><button>Go</button></div></div>
      <div class="row"><div><b>Route</b></div><div><select id="route"><option>Oral</option></select></div></div>`;
    expect(nameOf(grid, '#route')).toBe('Route');
    // Two controls share the box: no guessing.
    expect(nameOf(grid, '#MedicineNameSearch')).toBe('MedicineNameSearch');
    // Real labels and placeholders still come first.
    expect(nameOf('<label for="x">Email</label><input id="x" placeholder="you@x.com">', '#x')).toBe('Email');
    expect(nameOf('<div><span>Ignored</span></div><div><input id="y" placeholder="Search"></div>', '#y')).toBe('Search');
  });
});

describe('room for site knowledge', () => {
  it('grows with the model’s context window', () => {
    expect(knowledgeBudget(16384)).toBe(13107);
    expect(knowledgeBudget(4096)).toBe(3277);
    expect(knowledgeBudget(128000)).toBe(24000);
    expect(knowledgeBudget(undefined)).toBe(12000);
  });
});

describe('never-click buttons', () => {
  const site = { id: 's', name: 'Indici', description: '', color: '#000', sites: ['x.test'], enabled: true, providerId: null, model: '', agentIds: [], skillIds: [], disabledSkillIds: [], customToolIds: [], disabledToolIds: [], neverClick: ['Pharmac'], knowledge: [], createdAt: 1, updatedAt: 1 };

  it('are named in the prompt, even with no other knowledge', () => {
    expect(knowledgeSection([site], 'add medication').text).toMatch(/never click here[\s\S]*“Pharmac”/i);
  });

  it('are refused — no approval asked, nothing clicked', async () => {
    const sent: string[] = [];
    const ctx = {
      browser: {
        send: async (req: { kind: string }) => {
          sent.push(req.kind);
          if (req.kind === 'describe') return { name: 'Pharmac', role: 'button', tag: 'button', formHasPassword: false, formHasPayment: false, formIsSearch: false, formSubmitLabels: [] };
          throw new Error(`unexpected ${req.kind}`);
        },
      },
      settings: {},
      signal: new AbortController().signal,
      elements: new ElementMemory(),
      skills: [],
      neverClick: [' pharmac '],
    } as unknown as ToolContext;
    const click = BROWSER_TOOLS.find((t) => t.name === 'click')!;
    expect(await click.assess!({ id: 5, name: '', double: false }, ctx)).toBeNull();
    const out = await click.execute({ id: 5, name: '', double: false }, ctx);
    expect(out.output).toMatch(/^Not clicked: “Pharmac” is on this site’s never-click list/);
    expect(sent).not.toContain('click');
  });
});

describe('loop guard: repeated cycles of steps', () => {
  const type = 'Typing “Metformin” into “Find Medicine”';
  const search = 'Clicking “search (icon)”';
  const pick = 'Clicking “Metformin”';

  it('stops a type → search → pick cycle before its third round', async () => {
    const { repeatedCycle } = await import('./runtime/agentRun');
    expect(repeatedCycle([type, search, pick], type)).toBeNull();
    expect(repeatedCycle([type, search, pick, type, search, pick], type)).toEqual([type, search, pick]);
    expect(repeatedCycle(['A', 'B', 'A', 'B'], 'A')).toEqual(['A', 'B']);
  });

  it('lets a single repeated click through (paging), but not the same typing a third time', async () => {
    const { repeatedCycle } = await import('./runtime/agentRun');
    const next = 'Clicking “Next”';
    expect(repeatedCycle([next, next, next, next], next)).toBeNull();
    expect(repeatedCycle([type, search], type)).toBeNull();
    expect(repeatedCycle([type, search, type, 'Clicking “Clear”'], type)).toEqual([type]);
    // A different next step is fine.
    expect(repeatedCycle([type, search, pick, type, search, pick], 'Typing “2” into “Take”')).toBeNull();
  });
});
