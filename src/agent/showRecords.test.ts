import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AppConfig, SiteProfile, SiteShortcut } from '@/shared/types/config';
import { defaultConfig } from '@/shared/constants/defaults';
import { BUILT_IN_STAMP } from '@/shared/constants/builtIn';
import { normalizeConfig } from '@/shared/storage/configStore';
import { knowledgeSection } from './planner/siteKnowledge';
import { AgentRun } from './runtime/agentRun';
import { asksUser, looksLikeNewTask } from './runtime/followUp';
import { patientFrom, restAfter, shortcutFor, stepWorked } from './runtime/directTask';
import { kindOfTask } from './runtime/modelRoute';
import { formatSnapshot } from './tools/format';
import { sitesFor } from './tools/registry';

const restore = JSON.parse(readFileSync(join(process.cwd(), 'knowledge', 'web-agent-restore-indici.json'), 'utf8')) as { sites: SiteProfile[] };
const smart = restore.sites.filter((s) => s.id === 'site-smart-inbox');
const pms = restore.sites.find((s) => s.id === 'site_indici')!;

/** Runs a shortcut against a page that is only a list of control names. */
async function run(shortcut: SiteShortcut, page: { names: string[]; shown?: string[]; outputs?: Record<string, string> }) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const remembered: unknown[] = [];
  const self = {
    endWith: null,
    inFront: (_ctx: unknown, f: () => Promise<unknown>) => f(),
    runTool: async (call: { name: string; arguments: Record<string, unknown> }) => {
      calls.push({ name: call.name, args: call.arguments });
      return page.outputs?.[call.name] ?? (call.name === 'select_option' ? 'Selected “x” in “y”.' : call.name === 'type' ? 'Typed into “y”.' : 'Clicked “x”. Nothing on the page changed.');
    },
  };
  const ctx = {
    elements: { remember: (e: unknown[]) => remembered.push(...e) },
    browser: {
      currentTab: async () => ({ url: 'https://inbox-app-dev.vitonta.com/' }),
      send: async (m: { kind: string; query?: string; text?: string }) => {
        if (m.kind === 'findText') return { total: (page.shown ?? []).includes(m.text!) ? 1 : 0, matches: [] };
        if (m.kind === 'find') return { matches: page.names.map((name, i) => ({ id: i + 1, name })).filter((c) => c.name.includes(m.query!)), textMatches: [] };
        return {};
      },
    },
  };
  const by = new Map(['click', 'type', 'select_option'].map((n) => [n, {}]));
  const answer = await (AgentRun.prototype as unknown as { runShortcut: (...a: unknown[]) => Promise<string | null> }).runShortcut.call(self, shortcut, 'https://inbox-app-dev.vitonta.com/', by, ctx);
  return { answer, calls };
}

const CONTROLS = ['Reset', 'Search', 'Status (All)', 'File (All)', 'File All 3', 'Patient Name'];

describe('show me all abnormal records', () => {
  it.each(['show me all abnormal records', 'Show all abnormal records.', 'show abnormal records', 'abnormal records dikhao', 'please show me all the abnormal records'])('%s: the filter, by code', async (request) => {
    const { answer, calls } = await run(shortcutFor(smart, request)!, { names: CONTROLS });
    expect(calls.map((c) => c.name)).toEqual(['click', 'select_option', 'click']);
    expect(calls[1].args).toEqual({ option: 'Abnormal', id: 3 });
    expect(answer).toContain('In abnormal records ke sath kya karna chahte hain?');
  });

  it('never reads a record', async () => {
    const { calls } = await run(shortcutFor(smart, 'show me all abnormal records')!, { names: CONTROLS });
    expect(calls.map((c) => c.name)).not.toContain('read_records');
    expect(calls.map((c) => c.name)).not.toContain('read_page');
  });

  it('chooses Filed in “File (All)”, not the File All button, and asks what to do', async () => {
    const { answer, calls } = await run(shortcutFor(smart, 'show me all filed records')!, { names: CONTROLS });
    expect(calls[1].args).toEqual({ option: 'Filed', id: 4 });
    expect(answer).toContain('In records ke sath kya karna chahte hain?');
  });

  it('opens the search bar first when it has closed', async () => {
    const { calls } = await run(shortcutFor(smart, 'show me all abnormal records')!, { names: [...CONTROLS, 'Expand search controls'], shown: ['Expand search controls'] });
    expect(calls[0].args).toEqual({ id: 7 });
  });

  it('a Search that finds the same list is still done', async () => {
    const { answer } = await run(shortcutFor(smart, 'show me all abnormal records')!, { names: CONTROLS, outputs: { click: 'Clicked “Search”. Nothing on the page changed.' } });
    expect(answer).toContain('Abnormal');
  });

  it('a control not there, or a step that fails: the model takes it', async () => {
    expect((await run(shortcutFor(smart, 'show me all abnormal records')!, { names: ['Reset', 'Search'] })).answer).toBeNull();
    expect((await run(shortcutFor(smart, 'show me all abnormal records')!, { names: CONTROLS, outputs: { select_option: "Error: that option isn't in the list" } })).answer).toBeNull();
  });

  it('its question waits for the reply, and a new show is a new task', () => {
    expect(asksUser(shortcutFor(smart, 'show me all abnormal records')!.done)).toBe(true);
    expect(looksLikeNewTask('show me all filed records')).toBe(true);
    expect(looksLikeNewTask('summarize these')).toBe(false);
  });

  it.each(['summarize all abnormal records', 'what are the issues in abnormal records', 'show me all abnormal records and summarize them', 'why is this record abnormal'])('%s: not the filter', (request) => {
    expect(shortcutFor(smart, request)).toBeNull();
  });
});

describe('the records of one patient', () => {
  it.each([
    ['show me all abnormal records of Arya STARK', 'Arya STARK'],
    ['show abnormal records for mic mouse.', 'mic mouse'],
    ['Arya STARK ke abnormal records dikhao', 'Arya STARK'],
  ])('%s: types the name as written', async (request, name) => {
    const shortcut = shortcutFor(smart, request)!;
    const { calls, answer } = await run(shortcut, { names: CONTROLS });
    expect(calls.find((c) => c.name === 'type')?.args).toEqual({ text: name, id: 6 });
    expect(answer).toContain(name);
    expect(answer).not.toContain('{patient}');
  });

  it.each(['show me all abnormal records of this patient', 'show abnormal records of today', 'show abnormal records of arya and mic', 'show abnormal records of aaj'])('%s: the model works out who', (request) => {
    expect(shortcutFor(smart, request)).toBeNull();
  });
});

describe('what comes after opening the inbox', () => {
  const lead = shortcutFor(restore.sites.filter((s) => s.id === 'site_indici'), 'goto smart ai inbox')!;

  it('is a shortcut of the inbox too, with the name as written', () => {
    const request = 'goto smart AI inbox and show me all abnormal records of Arya STARK';
    const next = shortcutFor(smart, restAfter(lead, request), request)!;
    expect(next.done).toContain('Arya STARK');
  });
});

describe('which model a request needs', () => {
  it.each(['show me all abnormal records', 'show me all filed records', 'abnormal records dikhao', 'show abnormal results of arya stark', 'aaj kitne records aaye', 'how many records came today', 'how many abnormal records are there'])('%s: no big model', (request) => {
    expect(kindOfTask(request).kind).toBe('clicks');
  });

  it.each(['summarize all abnormal records', 'show me all abnormal records and summarize them', 'why is this record abnormal', 'how many records are abnormal and why', "show me the trend for this patient's cbc"])('%s: still analysis', (request) => {
    expect(kindOfTask(request).kind).toBe('analysis');
  });

  it.each(['file all normal records of arya stark', 'unfile this record', 'show abnormal records and file them'])('%s: still a change', (request) => {
    expect(kindOfTask(request).kind).toBe('judged');
  });
});

describe('the knowledge for showing and counting', () => {
  it('reaches a small task, with what it needs', () => {
    const shown = knowledgeSection(smart, 'show me all abnormal records of this patient', 16_000, true).text;
    expect(shown).toContain('Show records — the filter, and nothing more');
    expect(shown).not.toContain('### Workflow: Trend of a patient');
    expect(knowledgeSection(smart, 'aaj kitne records aaye', 16_000, true).text).toContain('How many records — from the counts');
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

  it('a step that chose or typed worked', () => {
    expect(stepWorked('Selected “Abnormal” in “Status (All)”.')).toBe(true);
    expect(stepWorked('Typed into “Patient Name”. It now contains: “Arya”.')).toBe(true);
    expect(stepWorked('Error: no such option')).toBe(false);
  });
});
