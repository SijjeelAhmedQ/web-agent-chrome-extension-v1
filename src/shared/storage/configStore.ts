import { defaultConfig, DEFAULT_SETTINGS } from '../constants/defaults';
import { BUILT_IN_TOOL_IDS, BUILT_IN_TOOLS, LEGACY_TOOL_IDS } from '../constants/tools';
import type { AppConfig, SiteProfile } from '../types/config';
import { getItem, setItem, watchItem } from './kv';

export const CONFIG_KEY = 'wa.config';
/** When the automatic backup file was last written. */
export const BACKUP_AT_KEY = 'wa.backupAt';
/** Set when the extension has just been installed: the options page offers to restore a backup. */
export const FRESH_INSTALL_KEY = 'wa.freshInstall';

/** Fills in anything missing from an older or imported config. */
/** The setup without secrets: API keys and custom tools' headers emptied — for files that leave the browser. */
export function stripKeys(config: AppConfig): AppConfig {
  const copy = structuredClone(config);
  copy.providers = copy.providers.map((p) => ({ ...p, apiKey: '' }));
  copy.customTools = copy.customTools.map((t) => ({ ...t, headers: '' }));
  return copy;
}

/**
 * Adds a file's agents, skills, custom tools and sites to the current setup — the file's version
 * wins for the same id — and connections it has that are not here yet (their keys stay empty).
 * Settings, existing connections and their keys are left as they are.
 */
export function mergeConfig(current: AppConfig, raw: Partial<AppConfig>): { config: AppConfig; added: Record<'agents' | 'skills' | 'customTools' | 'sites', number> } {
  const incoming = normalizeConfig({ ...raw, agents: raw.agents ?? [] });
  const byId = <T extends { id: string }>(mine: T[], theirs: T[]) => {
    const out = [...mine];
    for (const t of theirs) {
      const i = out.findIndex((m) => m.id === t.id);
      if (i >= 0) out[i] = t;
      else out.push(t);
    }
    return out;
  };
  const fromFile = (list: unknown) => (Array.isArray(list) ? list.length : 0);
  // A connection to an address already set up here is that one (with its key): the file's agents and
  // sites use it. Only connections to new addresses are added (their keys are left empty).
  const sameAs = new Map<string, string>();
  const keys = new Map<string, string>();
  const newProviders = (Array.isArray(raw.providers) ? incoming.providers : []).filter((p) => {
    const here = current.providers.find((c) => c.id === p.id || (c.baseUrl.replace(/\/+$/, '') === p.baseUrl.replace(/\/+$/, '') && c.preset === p.preset));
    if (here) {
      sameAs.set(p.id, here.id);
      if (!here.apiKey && p.apiKey) keys.set(here.id, p.apiKey);
    }
    return !here;
  });
  const provider = (id: string | null) => (id && sameAs.has(id) ? sameAs.get(id)! : id);
  const config: AppConfig = {
    ...current,
    agents: byId(current.agents, Array.isArray(raw.agents) ? incoming.agents.map((a) => ({ ...a, providerId: provider(a.providerId) })) : []),
    skills: byId(current.skills, Array.isArray(raw.skills) ? incoming.skills : []),
    customTools: byId(current.customTools, Array.isArray(raw.customTools) ? incoming.customTools : []),
    sites: byId(current.sites, incoming.sites.map((s) => ({ ...s, providerId: provider(s.providerId) }))),
    providers: [...current.providers.map((p) => (keys.has(p.id) ? { ...p, apiKey: keys.get(p.id)! } : p)), ...newProviders],
  };
  return { config: normalizeConfig(config), added: { agents: fromFile(raw.agents), skills: fromFile(raw.skills), customTools: fromFile(raw.customTools), sites: fromFile(raw.sites) } };
}

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
    neverClick: Array.isArray(raw.neverClick) ? raw.neverClick : [],
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
