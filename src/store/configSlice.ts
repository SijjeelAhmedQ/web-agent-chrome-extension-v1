import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { defaultConfig } from '@/shared/constants/defaults';
import { CUSTOM_PREFIX } from '@/shared/constants/tools';
import type { AgentConfig, AppConfig, CustomToolConfig, KnowledgeEntry, ProviderConfig, Settings, SiteProfile, SkillConfig } from '@/shared/types/config';

interface ConfigState {
  config: AppConfig;
  hydrated: boolean;
  /** Increments on user edits only — the persistence layer saves when it changes. */
  revision: number;
}

const initialState: ConfigState = { config: defaultConfig(), hydrated: false, revision: 0 };

const touch = (state: ConfigState) => {
  state.revision += 1;
};

function upsert<T extends { id: string }>(list: T[], item: T) {
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = item;
  else list.push(item);
}

export const configSlice = createSlice({
  name: 'config',
  initialState,
  reducers: {
    hydrate(state, action: PayloadAction<AppConfig>) {
      state.config = action.payload;
      state.hydrated = true;
    },
    replaceConfig(state, action: PayloadAction<AppConfig>) {
      state.config = action.payload;
      touch(state);
    },
    updateSettings(state, action: PayloadAction<Partial<Settings>>) {
      state.config.settings = { ...state.config.settings, ...action.payload };
      touch(state);
    },
    upsertAgent(state, action: PayloadAction<AgentConfig>) {
      upsert(state.config.agents, { ...action.payload, updatedAt: Date.now() });
      touch(state);
    },
    deleteAgent(state, action: PayloadAction<string>) {
      if (state.config.agents.length <= 1) return;
      state.config.agents = state.config.agents.filter((a) => a.id !== action.payload);
      for (const agent of state.config.agents) {
        if (agent.team) agent.team.memberIds = agent.team.memberIds.filter((id) => id !== action.payload);
      }
      for (const site of state.config.sites) site.agentIds = site.agentIds.filter((id) => id !== action.payload);
      if (state.config.settings.defaultAgentId === action.payload) state.config.settings.defaultAgentId = state.config.agents[0].id;
      touch(state);
    },
    upsertSkill(state, action: PayloadAction<{ skill: SkillConfig; agentIds?: string[] }>) {
      const { skill, agentIds } = action.payload;
      upsert(state.config.skills, { ...skill, updatedAt: Date.now() });
      if (agentIds) {
        for (const agent of state.config.agents) {
          const has = agent.skillIds.includes(skill.id);
          const want = agentIds.includes(agent.id);
          if (want && !has) agent.skillIds.push(skill.id);
          if (!want && has) agent.skillIds = agent.skillIds.filter((id) => id !== skill.id);
        }
      }
      touch(state);
    },
    deleteSkill(state, action: PayloadAction<string>) {
      state.config.skills = state.config.skills.filter((s) => s.id !== action.payload);
      for (const agent of state.config.agents) agent.skillIds = agent.skillIds.filter((id) => id !== action.payload);
      for (const site of state.config.sites) site.skillIds = site.skillIds.filter((id) => id !== action.payload);
      touch(state);
    },
    upsertCustomTool(state, action: PayloadAction<{ tool: CustomToolConfig; agentIds?: string[] }>) {
      const { tool, agentIds } = action.payload;
      upsert(state.config.customTools, { ...tool, updatedAt: Date.now() });
      const key = `${CUSTOM_PREFIX}${tool.id}`;
      if (agentIds) {
        for (const agent of state.config.agents) {
          const has = agent.toolIds.includes(key);
          const want = agentIds.includes(agent.id);
          if (want && !has) agent.toolIds.push(key);
          if (!want && has) agent.toolIds = agent.toolIds.filter((id) => id !== key);
        }
      }
      touch(state);
    },
    deleteCustomTool(state, action: PayloadAction<string>) {
      state.config.customTools = state.config.customTools.filter((t) => t.id !== action.payload);
      const key = `${CUSTOM_PREFIX}${action.payload}`;
      for (const agent of state.config.agents) agent.toolIds = agent.toolIds.filter((id) => id !== key);
      for (const site of state.config.sites) site.customToolIds = site.customToolIds.filter((id) => id !== action.payload);
      touch(state);
    },
    // ---- Site-based configuration
    upsertSite(state, action: PayloadAction<SiteProfile>) {
      upsert(state.config.sites, { ...action.payload, updatedAt: Date.now() });
      touch(state);
    },
    /** Deletes a site; its own skills and tools go too, unless an agent uses them. */
    deleteSite(state, action: PayloadAction<string>) {
      const site = state.config.sites.find((s) => s.id === action.payload);
      if (!site) return;
      state.config.sites = state.config.sites.filter((s) => s.id !== action.payload);
      const usedSkills = new Set([...state.config.agents.flatMap((a) => a.skillIds), ...state.config.sites.flatMap((s) => s.skillIds)]);
      state.config.skills = state.config.skills.filter((sk) => !site.skillIds.includes(sk.id) || usedSkills.has(sk.id));
      const usedTools = new Set([...state.config.agents.flatMap((a) => a.toolIds), ...state.config.sites.flatMap((s) => s.customToolIds.map((id) => `${CUSTOM_PREFIX}${id}`))]);
      state.config.customTools = state.config.customTools.filter((t) => !site.customToolIds.includes(t.id) || usedTools.has(`${CUSTOM_PREFIX}${t.id}`));
      touch(state);
    },
    upsertKnowledge(state, action: PayloadAction<{ siteId: string; entry: KnowledgeEntry }>) {
      const site = state.config.sites.find((s) => s.id === action.payload.siteId);
      if (!site) return;
      upsert(site.knowledge, { ...action.payload.entry, updatedAt: Date.now() });
      site.updatedAt = Date.now();
      touch(state);
    },
    deleteKnowledge(state, action: PayloadAction<{ siteId: string; entryId: string }>) {
      const site = state.config.sites.find((s) => s.id === action.payload.siteId);
      if (!site) return;
      site.knowledge = site.knowledge.filter((k) => k.id !== action.payload.entryId);
      touch(state);
    },
    /** Creates or edits a skill that belongs to a site. */
    upsertSiteSkill(state, action: PayloadAction<{ siteId: string; skill: SkillConfig }>) {
      const site = state.config.sites.find((s) => s.id === action.payload.siteId);
      if (!site) return;
      upsert(state.config.skills, { ...action.payload.skill, updatedAt: Date.now() });
      if (!site.skillIds.includes(action.payload.skill.id)) site.skillIds.push(action.payload.skill.id);
      touch(state);
    },
    upsertSiteTool(state, action: PayloadAction<{ siteId: string; tool: CustomToolConfig }>) {
      const site = state.config.sites.find((s) => s.id === action.payload.siteId);
      if (!site) return;
      upsert(state.config.customTools, { ...action.payload.tool, updatedAt: Date.now() });
      if (!site.customToolIds.includes(action.payload.tool.id)) site.customToolIds.push(action.payload.tool.id);
      touch(state);
    },
    toggleToolForAgent(state, action: PayloadAction<{ agentId: string; toolId: string; on: boolean }>) {
      const agent = state.config.agents.find((a) => a.id === action.payload.agentId);
      if (!agent) return;
      const has = agent.toolIds.includes(action.payload.toolId);
      if (action.payload.on && !has) agent.toolIds.push(action.payload.toolId);
      if (!action.payload.on && has) agent.toolIds = agent.toolIds.filter((id) => id !== action.payload.toolId);
      touch(state);
    },
    upsertProvider(state, action: PayloadAction<ProviderConfig>) {
      upsert(state.config.providers, action.payload);
      if (!state.config.settings.defaultProviderId) state.config.settings.defaultProviderId = action.payload.id;
      touch(state);
    },
    deleteProvider(state, action: PayloadAction<string>) {
      state.config.providers = state.config.providers.filter((p) => p.id !== action.payload);
      for (const agent of state.config.agents) if (agent.providerId === action.payload) agent.providerId = null;
      if (state.config.settings.defaultProviderId === action.payload) state.config.settings.defaultProviderId = state.config.providers[0]?.id ?? null;
      touch(state);
    },
  },
});

export const configActions = configSlice.actions;
