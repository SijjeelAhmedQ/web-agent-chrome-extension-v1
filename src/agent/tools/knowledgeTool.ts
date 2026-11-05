import { z } from 'zod';
import type { SiteProfile } from '@/shared/types/config';
import { formatEntry, searchKnowledge } from '../planner/siteKnowledge';
import type { AgentTool, ToolContext } from './types';

/**
 * Looks up the site's knowledge base — for entries that didn't fit in the prompt. `here` gives the site
 * profiles of the tab the agent is on now: a task that moved to another site (Indici → its Smart Inbox, in a
 * new tab) looks that site up first.
 */
export function knowledgeTool(sites: SiteProfile[], here?: (ctx: ToolContext) => Promise<SiteProfile[]>): AgentTool<{ topic: string }> {
  const names = sites.map((s) => s.name).join(', ') || 'the sites you set up';
  return {
    name: 'site_knowledge',
    description: `Look up what the user has taught you about ${names}: how its menus, pages and controls work, and step-by-step workflows. Use it before guessing how to do something on this site.`,
    schema: z.object({ topic: z.string().min(1).describe('What you need to know, e.g. "open a patient" or "Search & List"') }),
    risk: 'read',
    touchesPage: false,
    label: (a) => `Checking what I know about “${a.topic}”`,
    async execute(a, ctx) {
      const now = here ? await here(ctx).catch(() => []) : [];
      const moved = now.filter((s) => !sites.some((t) => t.id === s.id));
      const fromHere = moved.length ? searchKnowledge(moved, a.topic) : [];
      const found = fromHere.length ? fromHere : searchKnowledge(sites, a.topic);
      if (!found.length) return { output: `Nothing in the ${names} knowledge base about “${a.topic}”. Work it out from the page.`, note: 'Nothing saved about this' };
      // Already in the instructions, word for word: not again in the steps, where it would go with every later call.
      const prompt = ctx.knowledgeInPrompt?.() ?? '';
      const newHere = found.filter((e) => !prompt.includes(formatEntry(e)));
      if (!newHere.length) return { output: `“${found[0].title.trim()}” is already in your instructions, in full. Follow it there.`, note: 'Already in the instructions' };
      // A small context (a slow local model): the best entry in full, the others by name — a page of
      // workflows would push out the steps the task is on.
      const [best, ...rest] = newHere;
      const output =
        ctx.overviewTextChars && rest.length
          ? `${formatEntry(best)}\n\nAlso saved: ${rest.map((e) => `“${e.title.trim()}”`).join(', ')} — look one up by its name if you need it.`
          : newHere.map(formatEntry).join('\n\n');
      const from = fromHere.length ? moved.map((s) => s.name).join(', ') : names;
      return { output, note: `${newHere.length} ${newHere.length === 1 ? 'entry' : 'entries'} · ${from}` };
    },
  };
}
