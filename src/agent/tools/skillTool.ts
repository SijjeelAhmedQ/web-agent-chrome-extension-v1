import { z } from 'zod';
import type { SkillConfig } from '@/shared/types/config';
import type { AgentTool } from './types';

/** Loads an on-demand skill's instructions into the conversation when the agent decides it's relevant. */
export function skillTool(skills: SkillConfig[]): AgentTool<{ name: string }> {
  const find = (name: string) => {
    const n = name.trim().toLowerCase();
    return skills.find((s) => s.name.toLowerCase() === n) ?? skills.find((s) => s.name.toLowerCase().includes(n));
  };
  return {
    name: 'load_skill',
    description: `Load the full instructions of one of your skills when it is relevant to the task. Available: ${skills.map((s) => `"${s.name}"`).join(', ')}.`,
    schema: z.object({ name: z.string().describe('Skill name') }),
    risk: 'read',
    touchesPage: false,
    label: (a) => `Using the “${find(a.name)?.name ?? a.name}” skill`,
    async execute(a) {
      const skill = find(a.name);
      if (!skill) return { output: `No skill named "${a.name}". Available: ${skills.map((s) => s.name).join(', ')}.` };
      return { output: `Skill “${skill.name}” — follow these instructions:\n${skill.instructions}` };
    },
  };
}
