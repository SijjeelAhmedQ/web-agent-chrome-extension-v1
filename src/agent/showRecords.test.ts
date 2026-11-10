import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppConfig, SiteProfile } from '@/shared/types/config';
import { defaultConfig } from '@/shared/constants/defaults';
import { BUILT_IN_STAMP } from '@/shared/constants/builtIn';
import { normalizeConfig, normalizeSite } from '@/shared/storage/configStore';
import { corrected, knowledgeSection, oneSlip } from './planner/siteKnowledge';
import { listsEveryControl } from './runtime/agentRun';
import { buildSystemPrompt } from './planner/systemPrompt';
import { patientFrom } from './runtime/directTask';
import { formatSnapshot } from './tools/format';
import { sitesFor } from './tools/registry';

const restore = JSON.parse(readFileSync(join(process.cwd(), 'knowledge', 'web-agent-restore-indici.json'), 'utf8')) as { sites: SiteProfile[] };
const smart = restore.sites.filter((s) => s.id === 'site-smart-inbox');
const pms = restore.sites.find((s) => s.id === 'site_indici')!;

describe('nothing is a command', () => {
  it('no site holds requests the code does by itself', () => {
    for (const s of restore.sites) expect(s).not.toHaveProperty('shortcuts');
  });

  it('commands saved in a setup from before are dropped', () => {
    expect(normalizeSite({ ...smart[0], shortcuts: [{ says: ['x'] }] } as unknown as SiteProfile)).not.toHaveProperty('shortcuts');
  });
});

describe('the knowledge for showing and counting', () => {
  it('reaches a small task, with what it needs', () => {
    const shown = knowledgeSection(smart, 'show me all abnormal records of this patient', 16_000, true).text;
    expect(shown).toContain('Show records — the filter, and nothing more');
    expect(shown).not.toContain('### Workflow: Trend of a patient');
    expect(knowledgeSection(smart, 'aaj kitne records aaye', 16_000, true).text).toContain('How many records — from the counts');
  });

  it('tells the model to filter with its tools, stop and ask', () => {
    const show = smart[0].knowledge.find((e) => e.id === 'kb_smart_show')!.content;
    expect(show).toContain('in whatever words');
    expect(show).toContain("don't call read_records");
    expect(show).toContain('What would you like to do with these abnormal records?');
    expect(show).toContain('What would you like to do with these records?');
    expect(JSON.stringify(restore)).not.toMatch(/karna chahte|ke sath|inhe /);
  });

  it('searches with Search, and asks before Update & Search', () => {
    const show = smart[0].knowledge.find((e) => e.id === 'kb_smart_show')!.content;
    expect(show).toContain('Never "Update & Search"');
    expect(show).toContain('select_option("Status (All)", "Abnormal")');
    expect(smart[0].knowledge.find((e) => e.id === 'kb_smart_2')!.content).toContain('never "Update & Search"');
    expect(smart[0].askBefore).toContain('Update & Search');
  });

  it('asks which patient before opening a consult, in English', () => {
    const consult = smart[0].knowledge.find((e) => e.id === 'kb_smart_consult')!;
    expect(consult.content).toContain("Which patient's consult would you like to open?");
    expect(knowledgeSection(smart, 'go back to patient consult', 16_000, true).text).toContain("### Workflow: Open a patient's consult in Indici");
  });

  it('a summary of the list showing keeps the list', () => {
    expect(smart[0].knowledge.find((e) => e.id === 'kb_smart_5')!.content).toContain('unless the user means the list showing now');
  });

  it('says how to unfile', () => {
    expect(smart[0].knowledge.find((e) => e.id === 'kb_smart_6')!.content).toContain('Show all filed for this patient');
  });
});

describe('the patient open here', () => {
  const page = pms.patientPage!;

  it('is read from the consult’s own bar', () => {
    expect(patientFrom(page, [{ name: '×', context: 'dialog “Patient Alerts”' }, { name: 'image', context: 'bar “Arya STARK Location: Victoria Clinic 1”' }, { name: 'Not Enrolled with NES.', context: 'bar “NHI: ZAA3490”' }])).toEqual({ name: 'Arya STARK', nhi: 'ZAA3490' });
  });

  it('a page that doesn’t say: none', () => {
    expect(patientFrom(page, [{ name: 'Home' }])).toBeNull();
  });

  it('only on a consult’s address', () => {
    expect('https://pmstraining.vitonta.com/Home/accordionslider?patientid=x').toContain(page.at);
    expect('https://pmstraining.vitonta.com/Patient/Patients').not.toContain(page.at);
  });
});

describe('the setup that comes with the extension', () => {
  const site = (config: AppConfig, url: string) => sitesFor(config, url)[0]?.name;

  it('a new install knows both sites, with nothing to import', () => {
    const config = normalizeConfig(undefined);
    expect(site(config, 'https://pmstraining.vitonta.com/Patient/Patients')).toBe('indici training');
    expect(site(config, 'https://inbox-app-dev.vitonta.com/x')).toBe('indici smart inbox');
    expect(site(config, 'https://example.com/')).toBeUndefined();
    expect(config.agents.map((a) => a.id)).toEqual(expect.arrayContaining(['agent-indici', 'agent-smart-inbox']));
    expect(config.sites.find((s) => s.id === 'site-smart-inbox')!.knowledge.length).toBeGreaterThan(20);
    expect(config.sites.find((s) => s.id === 'site_indici')!.patientPage?.at).toBe('/Home/accordionslider');
  });

  it('a new version brings it up to date and keeps what the user chose', () => {
    const before = normalizeConfig(undefined);
    const agent = before.agents.find((a) => a.id === 'agent-smart-inbox')!;
    const old: AppConfig = {
      ...before,
      agents: before.agents.map((a) => (a.id === agent.id ? { ...a, instructions: 'old', providerId: 'or', model: 'm', autoModels: { small: 's', medium: 'm', big: 'b', chooser: 'c' } } : a)),
      sites: before.sites.map((s) => (s.id === 'site-smart-inbox' ? { ...s, knowledge: [], providerId: 'or', model: 'm', enabled: false } : s)),
      settings: { ...before.settings, builtInStamp: 'older' },
    };
    const now = normalizeConfig(old);
    const a = now.agents.find((x) => x.id === agent.id)!;
    const s = now.sites.find((x) => x.id === 'site-smart-inbox')!;
    expect(a.instructions).toContain('only filter the list');
    expect(a).toMatchObject({ providerId: 'or', model: 'm', autoModels: { small: 's' } });
    expect(s.knowledge.length).toBeGreaterThan(20);
    expect(s).toMatchObject({ providerId: 'or', model: 'm', enabled: false });
    expect(now.settings.builtInStamp).toBe(BUILT_IN_STAMP);
  });

  it('the same version leaves the user’s changes alone', () => {
    const before = normalizeConfig(undefined);
    const mine = { ...before, sites: before.sites.map((s) => (s.id === 'site-smart-inbox' ? { ...s, knowledge: [] } : s)) };
    expect(normalizeConfig(mine).sites.find((s) => s.id === 'site-smart-inbox')!.knowledge).toEqual([]);
  });

  it('holds no key', () => {
    expect(JSON.stringify(restore)).not.toMatch(/sk-or-|apiKey|encryptedString/i);
    expect(defaultConfig().providers).toEqual([]);
  });
});

describe('a page read says things once', () => {
  const snap = (over: object) => ({ title: 'T', url: 'https://x.test/', scroll: { atTop: true, atBottom: true, percent: 0, screens: 1 }, frames: [], headings: [], omitted: 0, text: '', elements: [], ...over }) as never;
  const el = (id: number, name: string, context?: string) => ({ id, name, role: 'button', tag: 'button', inViewport: true, ...(context ? { context } : {}) });

  it('a pop-up’s controls name their place once', () => {
    const out = formatSnapshot(snap({ elements: [el(1, 'A', 'dialog “P”'), el(2, 'B', 'dialog “P”'), el(3, 'C', 'row 1 “x”'), el(4, 'D', 'row 1 “x”')] }), 'overview');
    expect(out).toContain('[1] button "A" in dialog “P”');
    expect(out).toContain('[2] button "B" (same place)');
    expect(out).toContain('[3] button "C" in row 1 “x”');
    expect(out).toContain('[4] button "D" (same row)');
  });

  it('text that only repeats a control’s name goes from an overview', () => {
    const out = formatSnapshot(snap({ elements: [el(1, 'Home')], text: 'Home\nCBC 21/10/2026' }), 'overview');
    expect(out.split('Visible text (start):')[1]).toBe('\nCBC 21/10/2026');
  });

  it('reading a page keeps every line of its text', () => {
    const out = formatSnapshot(snap({ elements: [el(1, 'Normal')], text: 'HbA1c\nNormal' }), 'content');
    expect(out).toContain('HbA1c\nNormal');
  });

});

describe('fewer calls', () => {
  it('finds the knowledge through a typo', () => {
    expect(knowledgeSection(smart, 'shwo me all abnormal reocrds', 16_000, true).text).toContain('### Workflow: Show records — the filter, and nothing more');
  });

  it('a typo is one slip, and a word the knowledge has stays itself', () => {
    expect([oneSlip('shwo', 'show'), oneSlip('reocrd', 'record'), oneSlip('recrd', 'record'), oneSlip('recordd', 'record')]).toEqual([true, true, true, true]);
    expect([oneSlip('show', 'shut'), oneSlip('abnormal', 'normal')]).toEqual([false, false]);
    const entries = smart[0].knowledge;
    expect(corrected(new Set(['fill', 'shwo']), entries)).toEqual(new Set(['fill', 'show']));
    expect(corrected(new Set(['arya', 'zzzz']), entries)).toEqual(new Set(['arya', 'zzzz']));
  });

  it('no find_element when the read lists every control', () => {
    expect(listsEveryControl('Interactive elements (↓ = outside the visible area):\n[1] button "Search"')).toBe(true);
    expect(listsEveryControl('Interactive elements (↓ = outside the visible area):\n[1] button "Search"\n(+40 more not listed — use find_element)')).toBe(false);
    expect(listsEveryControl('Error: the page could not be read')).toBe(false);
  });
});

describe('the search bar', () => {
  const findRecords = () => smart[0].knowledge.find((e) => e.id === 'kb_smart_2')!.content;

  it('says how to set every field, in one fill_form', () => {
    const text = findRecords();
    for (const field of ['"Date range"', 'placeholder "From" and "To"', '"Category (All)"', '"Message Subject (All)"', '"Providers (All)"', '"Sender (All)"', '"AI (All)"', '"Status (All)"', '"File (All)"', 'ONE fill_form']) expect(text).toContain(field);
  });

  it('resets once, never twice', () => {
    expect(findRecords()).toContain('once in a task, never a second time');
  });

  it('reaches a request by dates, in a small prompt too', () => {
    const shown = knowledgeSection(smart, 'show all inbox records from 10/03/2026 10/11/2026', 16_000, true).text;
    expect(shown).toContain('### Workflow: Find records — search and filters');
    expect(shown).toContain('### Workflow: Show records — the filter, and nothing more');
  });

  it('a prompt without find_element doesn’t name it', () => {
    const agent = { name: 'A', description: '', instructions: '' } as never;
    const without = buildSystemPrompt({ agent, toolNames: ['read_page', 'click', 'type'], page: { title: '', url: '' }, readOnly: false, siteKnowledge: '', alwaysSkills: [], onDemandSkills: [] } as never);
    const withIt = buildSystemPrompt({ agent, toolNames: ['read_page', 'click', 'type', 'find_element'], page: { title: '', url: '' }, readOnly: false, siteKnowledge: '', alwaysSkills: [], onDemandSkills: [] } as never);
    expect(without).not.toContain('find_element');
    expect(withIt).toContain('find_element');
  });
});
