import type { KnowledgeEntry, KnowledgeKind, SiteProfile } from '@/shared/types/config';

/**
 * Turns a site's knowledge base into the part of the system prompt the agent reads on that
 * site. Rules, navigation and page notes come first; workflows are ranked by how well they
 * match the request, so the one for this task is in full and the rest are listed by title.
 */

export const KNOWLEDGE_KINDS: Record<KnowledgeKind, { label: string; heading: string }> = {
  rule: { label: 'Rule', heading: 'Rule' },
  navigation: { label: 'Navigation', heading: 'Navigation' },
  page: { label: 'Page & controls', heading: 'Page' },
  workflow: { label: 'Workflow', heading: 'Workflow' },
};

const ORDER: KnowledgeKind[] = ['rule', 'navigation', 'page', 'workflow'];
const STOP = new Set(['the', 'and', 'for', 'with', 'then', 'this', 'that', 'from', 'into', 'goto', 'select', 'click', 'open', 'please', 'karo', 'kar', 'aur', 'par', 'mai', 'mein', 'hai', 'ko', 'ka', 'ki', 'ke']);

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const wordsOf = (s: string) => new Set(norm(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w)));

/** How well an entry matches a request: shared words, title and example count most. */
export function relevance(entry: KnowledgeEntry, request: string): number {
  const asked = wordsOf(request);
  if (!asked.size) return 0;
  let score = 0;
  for (const w of wordsOf(`${entry.title} ${entry.trigger ?? ''}`)) if (asked.has(w)) score += 2;
  for (const w of wordsOf(entry.content)) if (asked.has(w)) score += 0.5;
  return score;
}

export function formatEntry(e: KnowledgeEntry): string {
  const head = `### ${KNOWLEDGE_KINDS[e.kind].heading}: ${e.title.trim()}`;
  const example = e.kind === 'workflow' && e.trigger?.trim() ? `For requests like: “${e.trigger.trim()}”\n` : '';
  return `${head}\n${example}${e.content.trim()}`;
}

export const activeKnowledge = (profiles: SiteProfile[]) => profiles.flatMap((p) => p.knowledge.filter((k) => k.enabled && (k.title.trim() || k.content.trim())));

/** The prompt section for the sites the agent is on, within about `budget` characters. */
export function knowledgeSection(profiles: SiteProfile[], request: string, budget = 6000): { text: string; left: number } {
  const entries = activeKnowledge(profiles);
  if (!entries.length) return { text: '', left: 0 };
  const ranked = entries
    .map((e) => ({ e, score: relevance(e, request) }))
    .sort((a, b) => {
      const wa = a.e.kind === 'workflow';
      const wb = b.e.kind === 'workflow';
      if (wa !== wb) return wa ? 1 : -1;
      if (wa) return b.score - a.score;
      return ORDER.indexOf(a.e.kind) - ORDER.indexOf(b.e.kind) || b.score - a.score;
    });
  const names = profiles.map((p) => p.name).join(', ');
  const lines = [
    `## What the user has taught you about ${names}`,
    'This comes from the user and is correct for this website. Follow it over your own guesses. When a workflow matches the request, follow its steps in order.',
  ];
  let used = lines.join('\n').length;
  const skipped: KnowledgeEntry[] = [];
  let workflowsInFull = 0;
  for (const { e, score } of ranked) {
    // Only the workflows that match this request are worth their space.
    const fits = e.kind !== 'workflow' || (score > 0 && workflowsInFull < 3);
    const block = formatEntry(e);
    if (fits && used + block.length + 2 <= budget) {
      lines.push('', block);
      used += block.length + 2;
      if (e.kind === 'workflow') workflowsInFull++;
    } else skipped.push(e);
  }
  if (skipped.length) {
    lines.push('', `More knowledge for this site (call site_knowledge with a topic to read one): ${skipped.map((e) => `“${e.title}”`).join(', ')}.`);
  }
  return { text: lines.join('\n'), left: skipped.length };
}

/** The best entries for a topic — for the site_knowledge tool. */
export function searchKnowledge(profiles: SiteProfile[], query: string, limit = 3): KnowledgeEntry[] {
  return activeKnowledge(profiles)
    .map((e) => ({ e, score: relevance(e, query) + (norm(e.title).includes(norm(query)) ? 5 : 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.e);
}
