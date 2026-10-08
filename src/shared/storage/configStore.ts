import { defaultConfig, DEFAULT_SETTINGS } from '../constants/defaults';
import type { AppConfig } from '../types/config';
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
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}), voice: { ...DEFAULT_SETTINGS.voice, ...(raw.settings?.voice ?? {}) } },
  };
  if (!config.agents.some((a) => a.id === config.settings.defaultAgentId)) {
    config.settings.defaultAgentId = config.agents[0].id;
  }
  if (config.settings.defaultProviderId && !config.providers.some((p) => p.id === config.settings.defaultProviderId)) {
    config.settings.defaultProviderId = config.providers[0]?.id ?? null;
  }
  return config;
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
