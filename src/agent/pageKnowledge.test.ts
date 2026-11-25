import { describe, expect, it } from 'vitest';
import type { KnowledgeEntry, SiteProfile } from '@/shared/types/config';
import { entryPath, knowledgeSection, PAGE_KNOWLEDGE, pageEntriesAt } from './planner/siteKnowledge';
import { promptParts } from './runtime/costLog';

const entry = (kind: KnowledgeEntry['kind'], title: string, content: string): KnowledgeEntry => ({ id: title, kind, title, content, enabled: true, createdAt: 1, updatedAt: 1 });
const site = (knowledge: KnowledgeEntry[]): SiteProfile =>
  ({ id: 's', name: 'Octans', sites: ['app.octans.test'], enabled: true, knowledge, neverClick: [], agentIds: [], skillIds: [], customToolIds: [], disabledSkillIds: [], disabledToolIds: [], createdAt: 1, updatedAt: 1 }) as unknown as SiteProfile;

const PEOPLE = entry('page', 'Practice members page', 'Address: /patients (title "Practice members · Octans").\nA list of practice members, with "Add practice member".');
const STATIONS = entry('page', 'Stations page', 'Address: /mentor-dashboard/layout. Title: Stations · Octans.\nThe wings and their stations.');
const HOME = entry('page', 'Dashboard page', 'Address: https://app.octans.test/\nToday at a glance.');
const TAGS = entry('page', 'Tags page', 'Address: /tags. Shows the practice tags.');
const HANDWRITTEN = entry('page', 'Consult screen', 'The consult has tabs at the top.');
const MAP = entry('navigation', 'Site map and main menu', '- Practice members — /patients\n- Stations — /mentor-dashboard/layout');
const RULE = entry('rule', 'Save and confirm changes', 'After Save, a message confirms it.');
const octans = site([PEOPLE, STATIONS, HOME, TAGS, HANDWRITTEN, MAP, RULE]);

describe('the knowledge of the page the agent is on', () => {
  it('reads which page an entry is about from its address — a path, a full address, a trailing full stop', () => {
    expect(entryPath(PEOPLE)).toBe('/patients');
    expect(entryPath(STATIONS)).toBe('/mentor-dashboard/layout');
    expect(entryPath(HOME)).toBe('/');
    expect(entryPath(HANDWRITTEN)).toBeNull();
    expect(entryPath(MAP)).toBeNull(); // only page entries are one page's
  });

  it('an address in the heading, or — none in the entry — in the way to the page', () => {
    const messages = entry('page', 'Messages page', '# Messages page (/messages)\n\nStaff messages.');
    const mentor = entry('page', 'Mentor home page', '# Mentor home\n\nThe treatment stations.');
    const way = entry('navigation', 'How to reach the Mentor home page', 'Path: "Mentor home · Octans" > click "Dobson Wing".\nPath: /mentor-dashboard');
    expect(entryPath(messages)).toBe('/messages');
    expect(entryPath(mentor, [mentor, way])).toBe('/mentor-dashboard');
    expect(entryPath(mentor, [mentor])).toBeNull();
  });

  it("finds the page's entries by the tab's address, its query and a trailing slash aside", () => {
    expect(pageEntriesAt([octans], 'https://app.octans.test/patients?tab=insight').map((e) => e.title)).toEqual(['Practice members page']);
    expect(pageEntriesAt([octans], 'https://app.octans.test/Mentor-Dashboard/layout/').map((e) => e.title)).toEqual(['Stations page']);
    expect(pageEntriesAt([octans], 'https://app.octans.test/')).toEqual([HOME]);
    expect(pageEntriesAt([octans], 'https://app.octans.test/messages')).toEqual([]);
  });

  it("gives the tab's page, the pages the request is about, the map and the rules — not every other page", () => {
    const { text } = knowledgeSection([octans], 'Open Stations and count them', 16_000, false, 'https://app.octans.test/');
    expect(text).toContain('### Page: Dashboard page'); // where the tab is
    expect(text).toContain('### Page: Stations page'); // what the request is about
    expect(text).toContain('### Navigation: Site map and main menu');
    expect(text).toContain('### Rule: Save and confirm changes');
    expect(text).toContain('### Page: Consult screen'); // no address: as before
    expect(text).not.toContain('### Page: Tags page');
    expect(text).not.toContain('### Page: Practice members page');
    expect(text).toMatch(/“Practice members page”.*comes with the step that opens it/);
  });

  it('without a tab to compare, every page as before', () => {
    const { text } = knowledgeSection([octans], 'Open Stations', 16_000);
    expect(text).toContain('### Page: Tags page');
    expect(text).toContain('### Page: Practice members page');
  });

  it("counts a page's knowledge given later as knowledge, in the token report", () => {
    const given = { role: 'user' as const, content: `${PAGE_KNOWLEDGE}\n### Page: Tags page\nAddress: /tags.` };
    const parts = promptParts([{ role: 'system', content: 'rules' }, { role: 'user', content: "(The user's request — this is your task:)\nOpen tags" }, given], [], '');
    expect(parts?.knowledge).toBeGreaterThan(5);
    expect(parts?.rest).toBeLessThan(20);
  });
});
