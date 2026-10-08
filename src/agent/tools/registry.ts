import { zodToJsonSchema } from 'zod-to-json-schema';
import { CUSTOM_PREFIX } from '@/shared/constants/tools';
import type { AgentConfig, AppConfig, SkillConfig } from '@/shared/types/config';
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
  const tools: AgentTool<any>[] = BROWSER_TOOLS.filter((t) => assigned.has(t.name) && !disabled.has(t.name));
  for (const ct of config.customTools) {
    if (assigned.has(`${CUSTOM_PREFIX}${ct.id}`)) tools.push(customTool(ct));
  }
  const { always, onDemand } = skillsFor(agent, config, url);
  if (onDemand.length) tools.push(skillTool(onDemand));
  return { tools, alwaysSkills: always, onDemandSkills: onDemand };
}

export function toolSpecs(tools: AgentTool<any>[]): ToolSpec[] {
  return tools.map((t) => {
    let parameters = t.jsonSchema;
    if (!parameters) {
      const { $schema: _ignored, ...schema } = zodToJsonSchema(t.schema, { target: 'openApi3', $refStrategy: 'none' }) as Record<string, unknown>;
      parameters = schema;
    }
    return { name: t.name, description: t.description, parameters };
  });
}
