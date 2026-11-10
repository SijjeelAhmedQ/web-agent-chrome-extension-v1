import { zodToJsonSchema } from 'zod-to-json-schema';
import { CUSTOM_PREFIX } from '@/shared/constants/tools';
import type { AgentConfig, AppConfig, SiteProfile, SkillConfig, ToolOverride } from '@/shared/types/config';
import { matchesSite } from '@/shared/utils';
import type { ToolSpec } from '../llm/types';
import { BROWSER_TOOLS } from './browserTools';
import { customTool } from './customTools';
import { knowledgeTool } from './knowledgeTool';
import { skillTool } from './skillTool';
import type { AgentTool, ToolContext } from './types';

export interface Toolset {
  tools: AgentTool<any>[];
  alwaysSkills: SkillConfig[];
  onDemandSkills: SkillConfig[];
  /** The site profiles for this page — their knowledge goes into the prompt. */
  sites: SiteProfile[];
}

/** Site profiles that apply on this address (enabled, with a matching host pattern). */
export function sitesFor(config: AppConfig, url: string): SiteProfile[] {
  if (!url) return [];
  return (config.sites ?? []).filter((s) => s.enabled && s.sites.length > 0 && matchesSite(url, s.sites));
}

/** The skills that apply on the given page: the agent's own, plus those of the site profiles here. */
export function skillsFor(agent: AgentConfig, config: AppConfig, url: string): { always: SkillConfig[]; onDemand: SkillConfig[] } {
  const own = agent.skillIds
    .map((id) => config.skills.find((s) => s.id === id))
    .filter((s): s is SkillConfig => !!s)
    .filter((s) => !s.sites.length || matchesSite(url, s.sites));
  const fromSites = sitesFor(config, url)
    .flatMap((site) => site.skillIds)
    .map((id) => config.skills.find((s) => s.id === id))
    .filter((s): s is SkillConfig => !!s);
  const off = new Set(sitesFor(config, url).flatMap((site) => site.disabledSkillIds ?? []));
  const skills = [...new Map([...own, ...fromSites].map((s) => [s.id, s])).values()].filter((s) => !off.has(s.id));
  return { always: skills.filter((s) => s.activation === 'always'), onDemand: skills.filter((s) => s.activation === 'on-demand') };
}

/** Everything an agent may call: its assigned built-in tools (minus globally disabled ones), its custom tools and, if needed, load_skill. */
export function buildToolset(agent: AgentConfig, config: AppConfig, url: string): Toolset {
  const sites = sitesFor(config, url);
  const disabled = new Set([...config.settings.disabledToolIds, ...sites.flatMap((s) => s.disabledToolIds)]);
  const assigned = new Set([...agent.toolIds, ...sites.flatMap((s) => s.customToolIds.map((id) => `${CUSTOM_PREFIX}${id}`))]);
  const overrides = config.settings.toolOverrides ?? {};
  const tools: AgentTool<any>[] = BROWSER_TOOLS.filter((t) => assigned.has(t.name) && !disabled.has(t.name)).map((t) => applyOverride(t, overrides[t.name]));
  for (const ct of config.customTools) {
    const key = `${CUSTOM_PREFIX}${ct.id}`;
    if (assigned.has(key) && !disabled.has(key)) tools.push(customTool(ct));
  }
  const { always, onDemand } = skillsFor(agent, config, url);
  if (onDemand.length) tools.push(skillTool(onDemand));
  // The tab the agent is on when it looks something up: another site's knowledge (a new tab it opened) comes first.
  const here = async (ctx: ToolContext) => sitesFor(config, (await ctx.browser.currentTab().catch(() => null))?.url ?? '');
  if (sites.some((s) => s.knowledge.some((k) => k.enabled))) tools.push(knowledgeTool(sites, here));
  return { tools, alwaysSkills: always, onDemandSkills: onDemand, sites };
}

/**
 * A schema without what tells the model nothing, in every call — at every depth (fill_form's fields too): an empty or
 * false default (the parameter is optional already) and an id's “more than 0”. The tool still checks them.
 */
function withoutNoise<T>(schema: T): T {
  if (Array.isArray(schema)) return schema.map(withoutNoise) as T;
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'exclusiveMinimum' || (key === 'default' && (value === '' || value === false))) continue;
    out[key] = withoutNoise(value);
  }
  return out as T;
}

/** Exactly what the model receives for a tool: name, description and parameters. */

export function specOf(t: AgentTool<any>): ToolSpec {
  let parameters = t.jsonSchema;
  if (!parameters) {
    // JSON Schema 7, not OpenAPI 3: OpenAPI's `"exclusiveMinimum": true` (an id's “> 0”) made DeepSeek
    // on OpenRouter unable to call click or type at all — it fell back to click_text for everything.
    // No `additionalProperties: false` either: it goes with every call, for every tool, and changes nothing.
    const { $schema: _ignored, additionalProperties: _closed, ...schema } = zodToJsonSchema(t.schema, { target: 'jsonSchema7', $refStrategy: 'none' }) as Record<string, unknown>;
    parameters = withoutNoise(schema);
  }
  return { name: t.name, description: t.description, parameters };
}

export function toolSpecs(tools: AgentTool<any>[]): ToolSpec[] {
  return tools.map(specOf);
}

type ParamSchema = { properties?: Record<string, { description?: string }> } & Record<string, unknown>;

/** A built-in tool with the user's edits: its description, parameter descriptions, approval. */
export function applyOverride(tool: AgentTool<any>, override: ToolOverride | undefined): AgentTool<any> {
  if (!override) return tool;
  const params = specOf(tool).parameters as ParamSchema;
  const edited = override.params ?? {};
  const properties = Object.fromEntries(
    Object.entries(params.properties ?? {}).map(([name, schema]) => [name, edited[name]?.trim() ? { ...schema, description: edited[name].trim() } : schema]),
  );
  return {
    ...tool,
    description: override.description?.trim() || tool.description,
    jsonSchema: { ...params, properties },
    alwaysAsk: override.alwaysAsk || undefined,
  };
}
