import { describe, expect, it } from 'vitest';
import { defaultConfig } from '@/shared/constants/defaults';
import { SITE_TEMPLATES } from '@/shared/constants/templates';
import { normalizeConfig } from '@/shared/storage/configStore';
import type { AppConfig, CustomToolConfig, SkillConfig } from '@/shared/types/config';
import { configActions, configSlice } from '@/store/configSlice';
import { knowledgeSection, searchKnowledge } from './planner/siteKnowledge';
import { buildSystemPrompt } from './planner/systemPrompt';
import { resolveProvider } from './runtime/agentRun';
import { buildToolset, sitesFor } from './tools/registry';

const INDICI = 'https://clinic.indici.test/Patients/Search';

function withIndici(): AppConfig {
  const config = defaultConfig();
  const indici = SITE_TEMPLATES.find((t) => t.key === 'indici')!.make();
  indici.sites = ['clinic.indici.test'];
  config.sites = [indici];
  config.providers = [
    { id: 'p1', name: 'Kaggle', kind: 'openai', preset: 'kaggle', baseUrl: 'https://k', apiKey: '', defaultModel: 'qwen3.5:9b', createdAt: 1 },
    { id: 'p2', name: 'Other', kind: 'openai', preset: 'custom', baseUrl: 'https://o', apiKey: '', defaultModel: 'other-model', createdAt: 1 },
  ];
  config.settings.defaultProviderId = 'p1';
  return config;
}

const skill = (id: string, activation: SkillConfig['activation'] = 'always'): SkillConfig => ({ id, name: id, description: '', instructions: `do ${id}`, activation, sites: [], createdAt: 1, updatedAt: 1 });
const tool = (id: string): CustomToolConfig => ({ id, name: id, label: id, description: 'x', method: 'GET', url: 'https://api.test', headers: '', params: [], needsApproval: false, createdAt: 1, updatedAt: 1 });

describe('site-based setup', () => {
  it('applies only on its own addresses, and only when on', () => {
    const config = withIndici();
    expect(sitesFor(config, INDICI).map((s) => s.name)).toEqual(['Indici']);
    expect(sitesFor(config, 'https://example.com/')).toEqual([]);
    config.sites[0].enabled = false;
    expect(sitesFor(config, INDICI)).toEqual([]);
    config.sites[0].enabled = true;
    config.sites[0].sites = [];
    expect(sitesFor(config, INDICI)).toEqual([]);
  });

  it('adds its skills, custom tools and knowledge tool there — and switches off its disabled tools', () => {
    const config = withIndici();
    config.skills.push(skill('indici_forms'), skill('indici_more', 'on-demand'));
    config.customTools.push(tool('pms_lookup'));
    Object.assign(config.sites[0], { skillIds: ['indici_forms', 'indici_more'], customToolIds: ['pms_lookup'], disabledToolIds: ['navigate'] });
    const agent = config.agents[0];
    const here = buildToolset(agent, config, INDICI);
    const names = here.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['pms_lookup', 'site_knowledge', 'load_skill', 'click_text']));
    expect(names).not.toContain('navigate');
    expect(here.alwaysSkills.map((s) => s.id)).toContain('indici_forms');
    expect(here.onDemandSkills.map((s) => s.id)).toContain('indici_more');
    const elsewhere = buildToolset(agent, config, 'https://example.com/');
    expect(elsewhere.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['navigate']));
    expect(elsewhere.tools.map((t) => t.name)).not.toContain('pms_lookup');
    expect(elsewhere.tools.map((t) => t.name)).not.toContain('site_knowledge');
    expect(elsewhere.alwaysSkills.map((s) => s.id)).not.toContain('indici_forms');
  });

  it('switches an agent’s own skill or custom tool off on the site only', () => {
    const config = withIndici();
    config.skills.push(skill('agent_skill'));
    config.customTools.push(tool('agent_tool'));
    const agent = config.agents[0];
    agent.skillIds.push('agent_skill');
    agent.toolIds.push('custom:agent_tool');
    Object.assign(config.sites[0], { agentIds: [agent.id], disabledSkillIds: ['agent_skill'], disabledToolIds: ['custom:agent_tool', 'read_page'] });
    const here = buildToolset(agent, config, INDICI);
    expect(here.alwaysSkills.map((s) => s.id)).not.toContain('agent_skill');
    expect(here.tools.map((t) => t.name)).not.toContain('agent_tool');
    expect(here.tools.map((t) => t.name)).not.toContain('read_page');
    const elsewhere = buildToolset(agent, config, 'https://example.com/');
    expect(elsewhere.alwaysSkills.map((s) => s.id)).toContain('agent_skill');
    expect(elsewhere.tools.map((t) => t.name)).toContain('agent_tool');
    // Deleting the agent takes it off the site.
    const state = configSlice.reducer({ config, hydrated: true, revision: 0 }, configActions.deleteAgent(agent.id));
    expect(state.config.sites[0].agentIds).toEqual([]);
  });

  it('runs every agent on the site’s own model when it has one', () => {
    const config = withIndici();
    const agent = config.agents[0];
    expect(resolveProvider(agent, config, INDICI)).toMatchObject({ provider: { id: 'p1' }, model: 'qwen3.5:9b' });
    config.sites[0].providerId = 'p2';
    expect(resolveProvider(agent, config, INDICI)).toMatchObject({ provider: { id: 'p2' }, model: 'other-model' });
    config.sites[0].model = 'medgemma';
    expect(resolveProvider(agent, config, INDICI).model).toBe('medgemma');
    expect(resolveProvider(agent, config, 'https://example.com/')).toMatchObject({ provider: { id: 'p1' }, model: 'qwen3.5:9b' });
  });

  it('puts the matching workflow in full into the prompt, rules first', () => {
    const config = withIndici();
    const { text } = knowledgeSection(config.sites, 'Goto Patients and select Search & List and select Sing TONY');
    expect(text).toMatch(/What the user has taught you about Indici/);
    expect(text).toMatch(/### Workflow: Select a patient from Search & List/);
    expect(text).toMatch(/click_text on the patient’s name/);
    expect(text.indexOf('### Rule:')).toBeLessThan(text.indexOf('### Workflow:'));
    // It reaches the system prompt.
    const prompt = buildSystemPrompt({ agent: config.agents[0], toolNames: ['read_page'], alwaysSkills: [], onDemandSkills: [], page: { title: 'Indici', url: INDICI }, readOnly: false, siteKnowledge: text });
    expect(prompt).toContain('### Workflow: Select a patient from Search & List');
  });

  it('sends workflows in full while they fit, even when the request is worded differently', () => {
    const config = withIndici();
    expect(knowledgeSection(config.sites, 'patient kholo luke ka').text).toMatch(/### Workflow: Select a patient from Search & List/);
    expect(knowledgeSection(config.sites, '').text).toMatch(/### Workflow: Select a patient from Search & List/);
  });

  it('lists what doesn’t fit by title only, matching workflows first', () => {
    const config = withIndici();
    const base = config.sites[0].knowledge.find((k) => k.kind === 'workflow')!;
    config.sites[0].knowledge.push({ ...base, id: 'w2', title: 'Print an invoice', trigger: 'print the invoice', content: 'Open Billing. '.repeat(100) });
    const budget = knowledgeSection(config.sites, '').text.length - 300;
    const { text, left } = knowledgeSection(config.sites, 'print the invoice', budget);
    expect(text).toMatch(/### Workflow: Print an invoice/);
    expect(left).toBe(1);
    expect(text).toMatch(/call site_knowledge.*“Select a patient from Search & List”/);
    expect(searchKnowledge(config.sites, 'select a patient')[0].title).toBe('Select a patient from Search & List');
    // A tight budget keeps the prompt small.
    expect(knowledgeSection(config.sites, 'select arya stark', 400).text.length).toBeLessThan(900);
  });

  it('keeps sites through save and load, filling missing fields', () => {
    const config = withIndici();
    const raw = JSON.parse(JSON.stringify({ ...config, sites: [{ name: 'Old', sites: ['x.test'], knowledge: [{ id: 'k', kind: 'rule', title: 't', content: 'c' }] }] }));
    const loaded = normalizeConfig(raw);
    expect(loaded.sites[0]).toMatchObject({ name: 'Old', enabled: true, skillIds: [], customToolIds: [], disabledToolIds: [], providerId: null, model: '' });
    expect(loaded.sites[0].knowledge[0].enabled).toBe(true);
    expect(normalizeConfig({ ...config, sites: undefined } as unknown as AppConfig).sites).toEqual([]);
  });

  it('deleting a site deletes its own skills and tools, not shared ones', () => {
    const config = withIndici();
    config.skills.push(skill('only_here'), skill('shared'));
    config.customTools.push(tool('only_tool'));
    config.agents[0].skillIds.push('shared');
    Object.assign(config.sites[0], { skillIds: ['only_here', 'shared'], customToolIds: ['only_tool'] });
    let state = configSlice.reducer({ config, hydrated: true, revision: 0 }, configActions.deleteSite(config.sites[0].id));
    expect(state.config.sites).toEqual([]);
    expect(state.config.skills.map((s) => s.id)).toContain('shared');
    expect(state.config.skills.map((s) => s.id)).not.toContain('only_here');
    expect(state.config.customTools.map((t) => t.id)).not.toContain('only_tool');
    // Deleting a skill removes it from sites too.
    const again = withIndici();
    again.skills.push(skill('k1'));
    again.sites[0].skillIds = ['k1'];
    state = configSlice.reducer({ config: again, hydrated: true, revision: 0 }, configActions.deleteSkill('k1'));
    expect(state.config.sites[0].skillIds).toEqual([]);
  });
});

describe('adding a backup file to the setup', () => {
  it('adds agents and sites (with knowledge) and keeps connections, keys and settings', async () => {
    const { mergeConfig, stripKeys } = await import('@/shared/storage/configStore');
    const { defaultConfig } = await import('@/shared/constants/defaults');
    const mine = defaultConfig();
    mine.providers = [{ id: 'or', name: 'OpenRouter', kind: 'openai', preset: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-mine', defaultModel: 'deepseek/deepseek-v4-flash', createdAt: 1 } as never];
    mine.settings.defaultProviderId = 'or';
    mine.settings.theme = 'dark';
    const backup = stripKeys({
      ...defaultConfig(),
      providers: [{ id: 'or-old', name: 'OpenRouter', kind: 'openai', preset: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1/', apiKey: 'sk-old', defaultModel: 'm', createdAt: 1 } as never],
      agents: [{ ...defaultConfig().agents[0], id: 'agent-indici', name: 'indici agent' }],
      sites: [{ id: 'site_indici', name: 'indici training', sites: ['pmstraining.vitonta.com'], providerId: 'or-old', knowledge: [{ id: 'k1', kind: 'rule', title: 'Pop-ups', content: 'close them', enabled: true, createdAt: 1, updatedAt: 1 }] } as never],
    });
    const { config, added } = mergeConfig(mine, backup);
    expect(config.agents.map((a) => a.name)).toContain('indici agent');
    expect(config.agents.length).toBe(mine.agents.length + 1);
    expect(config.sites[0].knowledge[0].title).toBe('Pop-ups');
    expect(config.providers).toHaveLength(1); // the file's OpenRouter is the one already here
    expect(config.sites[0].providerId).toBe('or');
    expect(config.providers[0].apiKey).toBe('sk-mine');
    expect(config.settings.theme).toBe('dark');
    expect(added).toEqual({ agents: 1, skills: backup.skills.length, customTools: backup.customTools.length, sites: 1 });
    expect(backup.providers[0].apiKey).toBe('');
  });
});
