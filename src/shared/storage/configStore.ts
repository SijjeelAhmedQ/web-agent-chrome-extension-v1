import { defaultConfig, DEFAULT_SETTINGS } from '../constants/defaults';
import { BUILT_IN_TOOL_IDS, BUILT_IN_TOOLS, LEGACY_TOOL_IDS } from '../constants/tools';
import type { AppConfig, SiteProfile } from '../types/config';
import { getItem, setItem, watchItem } from './kv';

export const CONFIG_KEY = 'wa.config';

/** Fills in anything missing from an older or imported config. */
export function normalizeConfig(raw: Partial<AppConfig> | undefined): AppConfig {
  const base = defaultConfig();
  if (!raw || typeof raw !== 'object') return base;
  const config: AppConfig = {
    version: 1,
    providers: Array.isArray(raw.providers) ? raw.providers : base.providers,
    agents: Array.isArray(raw.agents) && raw.agents.length ? raw.agents : base.agents,
    skills: Array.isArray(raw.skills) ? raw.skills : base.skills,
    customTools: Array.isArray(raw.customTools) ? raw.customTools : base.customTools,
    sites: Array.isArray(raw.sites) ? raw.sites.map(normalizeSite) : [],
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}), voice: { ...DEFAULT_SETTINGS.voice, ...(raw.settings?.voice ?? {}) } },
  };
  // Tools added since this config was saved: agents that read pages get the new read tools.
  const known = new Set(config.settings.knownToolIds ?? LEGACY_TOOL_IDS);
  const added = BUILT_IN_TOOLS.filter((t) => !known.has(t.id));
  if (added.length) {
    config.agents = config.agents.map((a) => {
      if (!a.toolIds.includes('read_page')) return a;
      const extra = added.filter((t) => t.risk === 'read' || a.toolIds.includes('click')).map((t) => t.id);
      return { ...a, toolIds: [...new Set([...a.toolIds, ...extra])] };
    });
  }
  config.settings.knownToolIds = BUILT_IN_TOOL_IDS;
  if (!config.agents.some((a) => a.id === config.settings.defaultAgentId)) {
    config.settings.defaultAgentId = config.agents[0].id;
  }
  if (config.settings.defaultProviderId && !config.providers.some((p) => p.id === config.settings.defaultProviderId)) {
    config.settings.defaultProviderId = config.providers[0]?.id ?? null;
  }
  return config;
}

/** A site profile with every field present (older or hand-edited files may miss some). */
export function normalizeSite(raw: Partial<SiteProfile>): SiteProfile {
  const now = Date.now();
  return {
    id: raw.id ?? `site_${now.toString(36)}`,
    name: raw.name ?? 'Website',
    description: raw.description ?? '',
    color: raw.color ?? '#0ea5e9',
    sites: Array.isArray(raw.sites) ? raw.sites : [],
    enabled: raw.enabled ?? true,
    providerId: raw.providerId ?? null,
    model: raw.model ?? '',
    agentIds: Array.isArray(raw.agentIds) ? raw.agentIds : [],
    skillIds: Array.isArray(raw.skillIds) ? raw.skillIds : [],
    disabledSkillIds: Array.isArray(raw.disabledSkillIds) ? raw.disabledSkillIds : [],
    customToolIds: Array.isArray(raw.customToolIds) ? raw.customToolIds : [],
    disabledToolIds: Array.isArray(raw.disabledToolIds) ? raw.disabledToolIds : [],
    knowledge: Array.isArray(raw.knowledge) ? raw.knowledge.map((k) => ({ ...k, enabled: k.enabled ?? true })) : [],
    createdAt: raw.createdAt ?? now,
    updatedAt: raw.updatedAt ?? now,
  };
}

export async function loadConfig(): Promise<AppConfig> {
  return normalizeConfig(await getItem<AppConfig>(CONFIG_KEY));
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await setItem(CONFIG_KEY, config);
}

export function watchConfig(listener: (config: AppConfig) => void): () => void {
  return watchItem<AppConfig>(CONFIG_KEY, (value) => listener(normalizeConfig(value)));
}
