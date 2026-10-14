import { z } from 'zod';
import type { SiteProfile } from '@/shared/types/config';
import { formatEntry, searchKnowledge } from '../planner/siteKnowledge';
import type { AgentTool } from './types';

/** Looks up the site's knowledge base — for entries that didn't fit in the prompt. */
export function knowledgeTool(sites: SiteProfile[]): AgentTool<{ topic: string }> {
  const names = sites.map((s) => s.name).join(', ');
  return {
    name: 'site_knowledge',
    description: `Look up what the user has taught you about ${names}: how its menus, pages and controls work, and step-by-step workflows. Use it before guessing how to do something on this site.`,
    schema: z.object({ topic: z.string().min(1).describe('What you need to know, e.g. "open a patient" or "Search & List"') }),
    risk: 'read',
    touchesPage: false,
    label: (a) => `Checking what I know about “${a.topic}”`,
    async execute(a) {
      const found = searchKnowledge(sites, a.topic);
      if (!found.length) return { output: `Nothing in the ${names} knowledge base about “${a.topic}”. Work it out from the page.`, note: 'Nothing saved about this' };
      return { output: found.map(formatEntry).join('\n\n'), note: `${found.length} ${found.length === 1 ? 'entry' : 'entries'} · ${names}` };
    },
  };
}
