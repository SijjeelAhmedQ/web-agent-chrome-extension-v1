import { describe, expect, it } from 'vitest';
import { defaultConfig } from '@/shared/constants/defaults';
import { DEFAULT_CRAWLER } from '@/shared/constants/defaults';
import { normalizeConfig } from '@/shared/storage/configStore';
import type { AppConfig, KnowledgeBase, SiteProfile } from '@/shared/types/config';
import type { ElementInfo } from '@/shared/types/page';
import { addProposals, mergeIntoBase, newKnowledgeBase } from './crawler/merge';
import { budgetFor, describePage, parseWritten } from './crawler/prompts';
import { dangerOf, dummyFor } from './crawler/risk';
import { isLoginUrl, isLogoutUrl, normalizeUrl, sameSite, templateOf } from './crawler/urls';
import { sitesFor } from './tools/registry';

const el = (p: Partial<ElementInfo>): ElementInfo => ({ id: 1, role: 'button', name: '', tag: 'button', inViewport: true, ...p });

describe('crawler addresses', () => {
  it('keeps one form of an address', () => {
    expect(normalizeUrl('https://a.com/x/?utm_source=m&b=1#top')).toBe('https://a.com/x?b=1');
    expect(normalizeUrl('/p//q/', 'https://a.com/z')).toBe('https://a.com/p/q');
    expect(normalizeUrl('https://a.com/#/patients/12')).toBe('https://a.com/#/patients/12');
    expect(normalizeUrl('mailto:x@y.z')).toBeNull();
    expect(normalizeUrl('https://a.com/file.pdf')).toBeNull();
  });

  it('reads record pages as one kind of page', () => {
    expect(templateOf('https://a.com/patients/123')).toBe(templateOf('https://a.com/patients/456'));
    expect(templateOf('https://a.com/patients/123?tab=notes')).not.toBe(templateOf('https://a.com/patients/123?tab=meds'));
    expect(templateOf('https://a.com/patients?id=1')).toBe(templateOf('https://a.com/patients?id=2'));
    expect(templateOf('https://a.com/#/orders/9f1c2a3b-1111-2222-3333-444455556666')).toBe(templateOf('https://a.com/#/orders/0a1c2a3b-1111-2222-3333-444455556666'));
    expect(templateOf('https://a.com/settings')).not.toBe(templateOf('https://a.com/reports'));
  });

  it('stays on the site', () => {
    expect(sameSite('https://www.a.com/x', 'a.com')).toBe(true);
    expect(sameSite('https://b.com/x', 'a.com')).toBe(false);
  });

  it('knows sign-in and sign-out addresses', () => {
    expect(isLoginUrl('https://a.com/account/login?next=/')).toBe(true);
    expect(isLoginUrl('https://a.com/#/signin')).toBe(true);
    expect(isLoginUrl('https://a.com/blog/login-tips')).toBe(false);
    expect(isLogoutUrl('https://a.com/logout')).toBe(true);
  });
});

describe('what needs the user’s OK', () => {
  it('asks before deleting, saving, sending, paying and signing out', () => {
    for (const name of ['Delete', 'Delete patient', 'Save', 'Send email', 'Pay now', 'Log out', 'Sign out', 'Submit', 'Archive']) expect(dangerOf(el({ name }))).not.toBeNull();
    expect(dangerOf(el({ name: 'Go', type: 'submit' }))).not.toBeNull();
    expect(dangerOf(el({ name: 'Account', role: 'link', href: '/logout' }))).not.toBeNull();
  });

  it('clicks everything else by itself', () => {
    for (const name of ['Patients', 'Search', 'Settings', 'Next', 'Filter', 'Add Patient', 'Messages', 'Reports', 'Updates log']) expect(dangerOf(el({ name }))).toBeNull();
    // The words are the user's: any language, any site.
    expect(dangerOf(el({ name: 'Eliminar paciente' }), ['eliminar'])).not.toBeNull();
    expect(dangerOf(el({ name: 'Delete' }), ['eliminar'])).toBeNull();
  });

  it('fills forms with the test values', () => {
    expect(dummyFor(el({ role: 'textbox', name: 'Email', type: 'text' }), DEFAULT_CRAWLER)).toBe('test@test.com');
    expect(dummyFor(el({ role: 'textbox', name: 'Ethnicity', type: 'text', picks: true }), DEFAULT_CRAWLER)).toBeNull();
    expect(dummyFor(el({ role: 'textbox', name: 'Mobile', type: 'tel' }), DEFAULT_CRAWLER)).toBe('1234567890');
    expect(dummyFor(el({ role: 'textbox', name: 'First Name', type: 'text' }), DEFAULT_CRAWLER)).toBe('Test User');
    expect(dummyFor(el({ role: 'textbox', name: 'Notes', value: 'already' }), DEFAULT_CRAWLER)).toBeNull();
    expect(dummyFor(el({ role: 'button', name: 'Save' }), DEFAULT_CRAWLER)).toBeNull();
    expect(dummyFor(el({ role: 'textbox', name: 'Date of birth', type: 'date' }), DEFAULT_CRAWLER)).toBeNull();
  });
});

describe('the model’s answer', () => {
  it('reads JSON in fences, after thinking', () => {
    const raw = '<think>hmm</think>```json\n{"entries":[{"kind":"page","title":"Patients page","content":"Lists patients."},{"kind":"workflow","title":"Find a patient","content":"1. Type the name","trigger":"find John"},{"kind":"bogus","title":"x","content":"y"}],"neverClick":["Delete"]}\n```';
    const w = parseWritten(raw);
    expect(w.entries.map((e) => e.kind)).toEqual(['page', 'workflow']);
    expect(w.entries[1].trigger).toBe('find John');
    expect(w.neverClick).toEqual(['Delete']);
  });

  it('gives nothing for an answer that is not JSON', () => {
    expect(parseWritten('Sorry, I cannot.').entries).toEqual([]);
  });

  it('keeps the page within the budget', () => {
    const text = describePage({ url: 'https://a.com', title: 'A', template: '/', headings: [], text: 'x'.repeat(50_000), controls: Array(500).fill('button “X”'), fields: [], clicks: [], dialogs: [] }, 8000);
    expect(text.length).toBeLessThan(9000);
    expect(budgetFor(16_384)).toBeGreaterThan(20_000);
    expect(budgetFor(undefined)).toBe(24_000);
  });
});

describe('saving the knowledge', () => {
  it('joins the same entry learned on two pages, and marks updates', () => {
    const existing = [{ id: 'k1', kind: 'rule' as const, title: 'Menus open on hover', content: 'old', enabled: true, createdAt: 0, updatedAt: 0 }];
    let list = addProposals([], [{ kind: 'navigation', title: 'Patients', content: 'Top menu › Patients', source: 'a' }], existing);
    list = addProposals(list, [{ kind: 'navigation', title: 'patients', content: 'Top menu › Patients\nAlso /patients', source: 'b' }, { kind: 'rule', title: 'Menus open on hover', content: 'new', source: 'b' }], existing);
    expect(list).toHaveLength(2);
    expect(list[0].content).toBe('Top menu › Patients\nAlso /patients');
    expect(list[1].update).toBe(true);
  });

  it('keeps old entries, updates the same ones, adds new ones', () => {
    const kb: KnowledgeBase = { ...newKnowledgeBase('https://app.a.com/home'), entries: [
      { id: 'k1', kind: 'rule', title: 'Old rule', content: 'stays', enabled: true, createdAt: 0, updatedAt: 0 },
      { id: 'k2', kind: 'page', title: 'Home page', content: 'old text', enabled: false, createdAt: 0, updatedAt: 0 },
    ], neverClick: ['Delete'] };
    const props = addProposals([], [{ kind: 'page', title: 'Home page', content: 'new text', source: 'x' }, { kind: 'workflow', title: 'Open a patient', content: '1. …', trigger: 'open John', source: 'x' }], kb.entries);
    const { kb: out, added, updated } = mergeIntoBase(kb, props, ['delete', 'Remove'], [{ url: 'https://app.a.com/home', title: 'Home', template: '/home', at: 1 }]);
    expect(added).toBe(1);
    expect(updated).toBe(1);
    expect(out.entries.find((e) => e.id === 'k1')?.content).toBe('stays');
    const home = out.entries.find((e) => e.id === 'k2')!;
    expect(home.content).toBe('new text');
    expect(home.enabled).toBe(false);
    expect(out.neverClick).toEqual(['Delete', 'Remove']);
    expect(out.pages).toHaveLength(1);
    expect(out.sites).toEqual(['app.a.com']);
  });
});

describe('the web agent reads the gathered knowledge base', () => {
  const site: SiteProfile = normalizeConfig({ sites: [{ id: 's1', name: 'Old', sites: ['app.a.com'], knowledge: [{ id: 'o1', kind: 'rule', title: 'Old', content: 'old', enabled: true, createdAt: 0, updatedAt: 0 }], neverClick: ['Pharmac'], agentIds: ['x'] } as SiteProfile] }, false).sites[0];
  const kb: KnowledgeBase = { ...newKnowledgeBase('https://app.a.com'), entries: [{ id: 'n1', kind: 'rule', title: 'New', content: 'new', enabled: true, createdAt: 0, updatedAt: 0 }], neverClick: ['Delete'] };
  const config = (sites: SiteProfile[], bases: KnowledgeBase[]): AppConfig => ({ ...defaultConfig(), sites, knowledgeBases: bases });

  it('only the new one where there is one', () => {
    const [here] = sitesFor(config([site], [kb]), 'https://app.a.com/x');
    expect(here.knowledge.map((k) => k.id)).toEqual(['n1']);
    expect(here.neverClick).toEqual(['Delete']);
    expect(here.agentIds).toEqual(['x']); // the Site base's other settings stay
  });

  it('the old one where there is none, or it is off', () => {
    expect(sitesFor(config([site], []), 'https://app.a.com/x')[0].knowledge[0].id).toBe('o1');
    expect(sitesFor(config([site], [{ ...kb, enabled: false }]), 'https://app.a.com/x')[0].knowledge[0].id).toBe('o1');
  });

  it('a site with no Site base gets the gathered one', () => {
    const [here] = sitesFor(config([], [kb]), 'https://app.a.com/x');
    expect(here.id).toBe(`gathered:${kb.id}`);
    expect(here.knowledge[0].id).toBe('n1');
    expect(sitesFor(config([], [kb]), 'https://other.com')).toEqual([]);
  });

  it('old setups load with no knowledge bases', () => {
    expect(normalizeConfig({ sites: [] } as Partial<AppConfig>).knowledgeBases).toEqual([]);
  });
});

describe('clicking icons and counting screens', async () => {
  const { labelOf, rowOf, screenSignature, sharedOutcome } = await import('./crawler/crawlRun');
  const { isSameScreen } = await import('./crawler/risk');
  const { isLearnRequest } = await import('@/ui/pages/sidepanel/knowledgeAgent');

  it('names icons that have no name, and finds their row', () => {
    expect(labelOf(el({ name: '', role: 'clickable', tag: 'span', context: 'row 1 “Christmas · 25 Dec”' }))).toBe('unnamed icon (span) in row 1 Christmas · 25 Dec');
    expect(labelOf(el({ name: 'Edit holiday' }))).toBe('Edit holiday');
    expect(labelOf(el({ name: '', role: 'textbox' }))).toBe('');
    expect(rowOf(el({ context: 'row 3 “x”' }))).toBe(3);
    expect(rowOf(el({}))).toBe(0);
  });

  it('the same screen on another day is not a new page', () => {
    expect(screenSignature({ title: 'Duty roster', headings: ['# Week of 12 Nov 2026'] })).toBe(screenSignature({ title: 'Duty roster', headings: ['# Week of 19 Nov 2026'] }));
    expect(screenSignature({ title: 'Duty roster', headings: ['# Roster'] })).not.toBe(screenSignature({ title: 'Duty roster', headings: ['# Approvals'] }));
  });

  it('paging and folding the sidebar are not screens', () => {
    for (const n of ['Next week', 'Previous', 'Toggle sidebar', 'Year', 'Month', '2', '›']) expect(isSameScreen(n)).toBe(true);
    for (const n of ['Roster', 'Only mine to decide', 'Edit holiday']) expect(isSameScreen(n)).toBe(false);
  });

  it('a menu or a page link is learned once for the whole site', () => {
    expect(sharedOutcome('opens the page /roster')).toBe(true);
    expect(sharedOutcome('opens a menu: “A”')).toBe(true);
    expect(sharedOutcome('opens the pop-up “Edit holiday”')).toBe(false);
  });

  it('knows “learn this website”', () => {
    for (const t of ['Learn this website', 'learn this site', 'Crawl this website.', 'gather knowledge of this site', 'is website ko learn karo']) expect(isLearnRequest(t)).toBe(true);
    for (const t of ['learn the patient list and open John', 'Summarize this page']) expect(isLearnRequest(t)).toBe(false);
  });
});

describe('one entry per topic', async () => {
  const { sameTopic } = await import('./crawler/merge');
  it('joins titles that say the same', () => {
    expect(sameTopic('Sidebar toggle', 'Sidebar Toggle Behavior')).toBe(true);
    expect(sameTopic('Tag filtering', 'Tags filtering')).toBe(true);
    expect(sameTopic('Search for a practice member', 'Edit a practice member’s details')).toBe(false);
    expect(sameTopic('Radiology page', 'X-ray bookings page')).toBe(false);
  });
});

describe('a learned knowledge base gets its site and agent', () => {
  it('makes a site with one agent of its own, once', async () => {
    const { configSlice, configActions } = await import('@/store/configSlice');
    const { normalizeConfig } = await import('@/shared/storage/configStore');
    const kb = { id: 'kb1', name: 'Octans', sites: ['app.octans.test'], startUrl: 'https://app.octans.test/', enabled: true, entries: [], neverClick: [], pages: [], createdAt: 1, updatedAt: 1 };
    let state: ReturnType<typeof configSlice.reducer> = { config: { ...normalizeConfig({}, true), knowledgeBases: [kb] }, hydrated: true, revision: 0 };
    const agentsBefore = state.config.agents.length;
    state = configSlice.reducer(state, configActions.adoptKnowledgeBase('kb1'));
    const site = state.config.sites.find((s) => s.sites.includes('app.octans.test'))!;
    expect(site.name).toBe('Octans');
    expect(site.agentIds).toHaveLength(1);
    expect(state.config.agents.find((a) => a.id === site.agentIds[0])!.name).toBe('Octans Agent');
    state = configSlice.reducer(state, configActions.adoptKnowledgeBase('kb1'));
    expect(state.config.sites.filter((s) => s.sites.includes('app.octans.test'))).toHaveLength(1);
    expect(state.config.agents).toHaveLength(agentsBefore + 1);
  });
});

describe('crawler: dropdowns and generated names', () => {
  it('names a control by where it is when its name is a generated id', async () => {
    const { labelOf, GENERATED_NAME, isDropdown } = await import('./crawler/crawlRun');
    expect(GENERATED_NAME.test('mantine-7h7thhc5z')).toBe(true);
    expect(GENERATED_NAME.test('react-select-3-input')).toBe(true);
    expect(GENERATED_NAME.test('First name')).toBe(false);
    expect(GENERATED_NAME.test('Follow-up')).toBe(false);
    expect(labelOf({ name: 'mantine-7h7thhc5z', role: 'button', tag: 'button', context: 'Edit practice member' })).toBe('unnamed icon (button) in Edit practice member');
    expect(isDropdown({ role: 'textbox', expanded: false })).toBe(true);
    expect(isDropdown({ role: 'textbox' })).toBe(false);
    expect(isDropdown({ role: 'combobox' })).toBe(true);
    expect(isDropdown({ role: 'combobox', options: ['a'] })).toBe(false);
    expect(isDropdown({ role: 'button', expanded: false })).toBe(false);
    expect(isDropdown({ role: 'textbox', picks: true })).toBe(true);
  });
});

describe('crawler: saving forms with test values', () => {
  it('never saves a form that edits a record', async () => {
    const { EDIT_FORM } = await import('./crawler/crawlRun');
    expect(EDIT_FORM.test('Practice membersEdit practice member')).toBe(true);
    expect(EDIT_FORM.test('Item codesEdit — UX1007A-ADJ')).toBe(true);
    expect(EDIT_FORM.test('Practice membersNew practice member')).toBe(false);
    expect(EDIT_FORM.test('Public holidaysAdd holiday')).toBe(false);
    expect(EDIT_FORM.test('InvoicesNew credit note')).toBe(false);
  });
});

describe('crawler: list filters are not typed into', () => {
  it('knows a list search or toolbar field from a form field', async () => {
    const { isListFilter } = await import('./crawler/crawlRun');
    expect(isListFilter({ role: 'searchbox', name: 'Practice members' })).toBe(true);
    expect(isListFilter({ role: 'textbox', name: 'Provider', context: 'bar “Reset”' })).toBe(true);
    expect(isListFilter({ role: 'textbox', name: 'Filter by category' })).toBe(true);
    expect(isListFilter({ role: 'textbox', name: 'First Name *' })).toBe(false);
    expect(isListFilter({ role: 'searchbox', name: 'Search Address', inBlockingPopup: 'New practice member' })).toBe(false);
  });
});

describe('crawler: dates and choices', () => {
  it('writes a test date the way the field asks', async () => {
    const { formatDate, isDateField, isDateRange, PLACEHOLDER_CHOICE } = await import('./crawler/crawlRun');
    const d = new Date(1990, 4, 15);
    expect(formatDate(d, { placeholder: 'DD/MM/YYYY' })).toBe('15/05/1990');
    expect(formatDate(d, { placeholder: 'MM/DD/YYYY' })).toBe('05/15/1990');
    expect(formatDate(d, { placeholder: 'YYYY-MM-DD' })).toBe('1990-05-15');
    expect(formatDate(d, { type: 'date' })).toBe('1990-05-15');
    expect(isDateField({ role: 'textbox', name: 'Date of Birth *', placeholder: 'DD/MM/YYYY' })).toBe(true);
    expect(isDateField({ role: 'textbox', name: 'Update notes' })).toBe(false);
    expect(isDateField({ role: 'textbox', name: 'x', type: 'date' })).toBe(true);
    expect(isDateRange({ name: 'Date range' })).toBe(true);
    expect(isDateRange({ name: 'Date of Birth' })).toBe(false);
    expect(PLACEHOLDER_CHOICE.test('Choose a provider')).toBe(true);
    expect(PLACEHOLDER_CHOICE.test('Female')).toBe(false);
  });
});

describe('crawler: a form’s own examples', () => {
  it('takes the example a field or message shows', async () => {
    const { exampleIn } = await import('./crawler/risk');
    expect(exampleIn('e.g. ABC1235')).toBe('ABC1235');
    expect(exampleIn('Use latitude,longitude, e.g. -36.8485,174.7633.')).toBe('-36.8485,174.7633');
    expect(exampleIn('NHI is usually 3 letters then 4 characters (I and O unused).')).toBeNull();
    expect(exampleIn('21 555 0100')).toBeNull();
    expect(dummyFor(el({ role: 'textbox', name: 'NHI Number', placeholder: 'e.g. ABC1235' }), DEFAULT_CRAWLER)).toBe('ABC1235');
  });
});

describe('crawler: fixing what a refused save said', () => {
  it('makes a taken value unique in the same shape, and knows a colour field', async () => {
    const { uniqueLike, ERROR_WORDS } = await import('./crawler/crawlRun');
    const v = uniqueLike('ABC1235');
    expect(v).toMatch(/^[A-HJ-NP-Z]{3}\d{4}$/);
    expect(uniqueLike('test@test.com')).toMatch(/^[a-z]{4}@[a-z]{4}\.[a-z]{3}$/);
    expect(ERROR_WORDS.test('A practice member with this NHI already exists')).toBe(true);
    expect(ERROR_WORDS.test('Psychosocial or communication caution')).toBe(false);
    expect(dummyFor(el({ role: 'textbox', name: 'Colour override' }), DEFAULT_CRAWLER)).toBe('#2563EB');
  });
});

describe('crawler: a message names a field', () => {
  it('by its label or a telling word of it', async () => {
    const { mentions } = await import('./crawler/crawlRun');
    expect(mentions('That NHI is already on file for Jordan Taylor.', 'NHI Number')).toBe(true);
    expect(mentions('Use latitude,longitude', 'Location')).toBe(false);
    expect(mentions('Location: use latitude,longitude', 'Location')).toBe(true);
    expect(mentions('Choose a provider', 'Last Name *')).toBe(false);
    expect(dummyFor(el({ role: 'textbox', name: 'Location', hint: 'Use latitude,longitude, e.g. -36.8485,174.7633' }), DEFAULT_CRAWLER)).toBe('-36.8485,174.7633');
  });
});

describe('crawler: a series of slots is tried once', () => {
  it('gives slots one kind', async () => {
    const { sameKindOf } = await import('./crawler/crawlRun');
    expect(sameKindOf('Book 12:00 in Bessie Swinney')).toBe(sameKindOf('Book 12:15 in David M Crain'));
    expect(sameKindOf('Sunday 1 November · No coverage')).toBe(sameKindOf('Monday 2 November · No coverage'));
    expect(sameKindOf('Add practice member')).toBeNull();
  });
});

describe('crawler: forms that reach the world are not saved', () => {
  it('knows a booking or sending form', async () => {
    const { REAL_EFFECT_FORM } = await import('./crawler/crawlRun');
    expect(REAL_EFFECT_FORM.test('DiaryBook Appointment')).toBe(true);
    expect(REAL_EFFECT_FORM.test('MessagesNew message')).toBe(true);
    expect(REAL_EFFECT_FORM.test('Public holidaysAdd holiday')).toBe(false);
    expect(REAL_EFFECT_FORM.test('TagsNew tag')).toBe(false);
  });
});

describe('a drawer open over a table', async () => {
  const { describeElement } = await import('@/extension/content/snapshot');
  it('marks the drawer’s fields, not the rows behind it', () => {
    document.body.innerHTML = `
      <table><tbody><tr><td><input type="checkbox" id="row"></td><td>Tall Table 1</td></tr></tbody></table>
      <div role="dialog" aria-labelledby="t"><h2 id="t">Edit Tall Table 2</h2>
        <label for="name">Name</label><input id="name" value="Tall Table 2"><input type="checkbox" id="active">
        <div role="listbox"><div role="option" id="opt">Medium Table</div></div></div>`;
    expect(describeElement(document.getElementById('row')!).inDialog).toBeUndefined();
    expect(describeElement(document.getElementById('name')!).inDialog).toBe('Edit Tall Table 2');
    expect(describeElement(document.getElementById('active')!).inDialog).toBe('Edit Tall Table 2');
  });
});

describe('a booking’s start and end time', async () => {
  const { isTimeField, timeFor } = await import('./crawler/crawlRun');
  const f = (o: Partial<{ role: string; type: string; name: string; label: string; placeholder: string }>) => ({ role: 'textbox', name: '', ...o });
  it('knows a time field from a date one', () => {
    expect(isTimeField(f({ type: 'time', name: 'Start' }))).toBe(true);
    expect(isTimeField(f({ name: 'Start time' }))).toBe(true);
    expect(isTimeField(f({ name: 'Start *' }))).toBe(true);
    expect(isTimeField(f({ name: 'From', placeholder: 'hh:mm' }))).toBe(true);
    expect(isTimeField(f({ name: 'Start date' }))).toBe(false);
    expect(isTimeField(f({ name: 'Timezone' }))).toBe(false);
    expect(isTimeField(f({ name: 'Notes' }))).toBe(false);
  });
  it('gives a start and a later end, with AM/PM when the mask asks', () => {
    expect(timeFor(f({ type: 'time', name: 'Start time' }))).toBe('10:30');
    expect(timeFor(f({ type: 'time', name: 'End time' }))).toBe('11:00');
    expect(timeFor(f({ name: 'Start time', placeholder: 'hh:mm AM' }))).toBe('10:30 AM');
  });
});

describe('the tabs of one record page', async () => {
  const { pageOfScreen, templateOf } = await import('./crawler/urls');
  const id = '24c9ea8d-f066-4b2a-969d-ee2db277ac10';
  it('are other screens, but one page', () => {
    const a = `https://x.com/patients/${id}?tab=insight`;
    const b = `https://x.com/patients/${id}?tab=overview`;
    expect(templateOf(a)).not.toBe(templateOf(b));
    expect(pageOfScreen(a)).toBe('/patients/:id');
    expect(pageOfScreen(b)).toBe(pageOfScreen(`https://x.com/patients/${id}`));
    expect(pageOfScreen(`https://x.com/patients/${id}?q=1&tab=notes`)).toBe('/patients/:id?q');
    expect(pageOfScreen(`https://x.com/patients/${id}?tab=notes&q=1`)).toBe('/patients/:id?q');
  });
});
