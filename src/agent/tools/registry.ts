import { zodToJsonSchema } from 'zod-to-json-schema';
import { CUSTOM_PREFIX } from '@/shared/constants/tools';
import type { AgentConfig, AppConfig, SkillConfig, ToolOverride } from '@/shared/types/config';
import { matchesSite } from '@/shared/utils';
import type { ToolSpec } from '../llm/types';
import { BROWSER_TOOLS } from './browserTools';
import { customTool } from './customTools';
import { skillTool } from './skillTool';
import type { AgentTool } from './types';

export interface Toolset {
  tools: AgentTool<any>[];
  alwaysSkills: SkillConfig[];
  onDemandSkills: SkillConfig[];
}

/** The skills of an agent that apply on the given page. */
export function skillsFor(agent: AgentConfig, config: AppConfig, url: string): { always: SkillConfig[]; onDemand: SkillConfig[] } {
  const skills = agent.skillIds
    .map((id) => config.skills.find((s) => s.id === id))
    .filter((s): s is SkillConfig => !!s)
    .filter((s) => !s.sites.length || matchesSite(url, s.sites));
  return { always: skills.filter((s) => s.activation === 'always'), onDemand: skills.filter((s) => s.activation === 'on-demand') };
}

/** Everything an agent may call: its assigned built-in tools (minus globally disabled ones), its custom tools and, if needed, load_skill. */
export function buildToolset(agent: AgentConfig, config: AppConfig, url: string): Toolset {
  const disabled = new Set(config.settings.disabledToolIds);
  const assigned = new Set(agent.toolIds);
  const overrides = config.settings.toolOverrides ?? {};
  const tools: AgentTool<any>[] = BROWSER_TOOLS.filter((t) => assigned.has(t.name) && !disabled.has(t.name)).map((t) => applyOverride(t, overrides[t.name]));
  for (const ct of config.customTools) {
    if (assigned.has(`${CUSTOM_PREFIX}${ct.id}`)) tools.push(customTool(ct));
  }
  const { always, onDemand } = skillsFor(agent, config, url);
  if (onDemand.length) tools.push(skillTool(onDemand));
  return { tools, alwaysSkills: always, onDemandSkills: onDemand };
}

/** Exactly what the model receives for a tool: name, description and parameters. */
export function specOf(t: AgentTool<any>): ToolSpec {
  let parameters = t.jsonSchema;
  if (!parameters) {
    const { $schema: _ignored, ...schema } = zodToJsonSchema(t.schema, { target: 'openApi3', $refStrategy: 'none' }) as Record<string, unknown>;
    parameters = schema;
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
