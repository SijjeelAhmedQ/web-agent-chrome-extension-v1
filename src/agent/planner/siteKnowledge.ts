import type { KnowledgeEntry, KnowledgeKind, SiteProfile } from '@/shared/types/config';

/**
 * Turns a site's knowledge base into the part of the system prompt the agent reads on that
 * site. Rules and navigation always go in full (they hold whatever the task); page notes and
 * workflows only when they share a word with the request — the rest is listed by title, for
 * site_knowledge to read when the task needs one. The prompt goes with every call of a task:
 * a site's whole knowledge (Indici's: 40,000 characters) in it was most of what “goto patients” cost.
 * A request with no words to match (“OK”) gets everything that fits, as before.
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
/** One form of a word for matching: “patients” and “patient”, “inboxes” and “inbox”, “entries” and “entry”. */
const stem = (w: string) => (w.length < 5 ? w : w.endsWith('ies') ? `${w.slice(0, -3)}y` : /(x|ch|sh|ss)es$/.test(w) ? w.slice(0, -2) : /[^su]s$/.test(w) ? w.slice(0, -1) : w);
const wordsOf = (s: string) => new Set(norm(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w)).map(stem));

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

/**
 * How many characters of site knowledge fit a model: about a fifth of its context window
 * (16k tokens → ~13k characters), never less than 3,000 or more than 48,000.
 */
export function knowledgeBudget(contextTokens: number | undefined): number {
  // No limit given: a cloud model (DeepSeek, Claude, GPT…) with a large context — room for a site's whole knowledge.
  if (!contextTokens) return 48_000;
  // A small context (Kaggle's 16K) also holds the tools, the instructions and every step: knowledge gets less of it.
  const share = contextTokens <= 32_768 ? 0.55 : 0.8;
  return Math.min(48_000, Math.max(3_000, Math.round(contextTokens * share)));
}

/** The prompt section for the sites the agent is on, within about `budget` characters. */
export function knowledgeSection(profiles: SiteProfile[], request: string, budget = 12_000): { text: string; left: number } {
  const entries = activeKnowledge(profiles);
  if (!entries.length && !profiles.some((p) => p.neverClick?.length)) return { text: '', left: 0 };
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
  const never = [...new Set(profiles.flatMap((p) => p.neverClick ?? []).map((n) => n.trim()).filter(Boolean))];
  if (never.length) {
    lines.push('', `### Rule: Buttons you never click here`, `The user clicks these themselves: ${never.map((n) => `“${n}”`).join(', ')}. When everything before them is done, stop and tell the user it is ready.`);
  }
  let used = lines.join('\n').length;
  const skipped: KnowledgeEntry[] = [];
  // A request with words to match: page notes and workflows that don't match wait for site_knowledge. A match is a
  // word of the title or example, or two words of the text — one (“patient”) is in nearly every entry of a site.
  const matchable = wordsOf(request).size > 0;
  for (const { e, score } of ranked) {
    const block = formatEntry(e);
    const always = e.kind === 'rule' || e.kind === 'navigation';
    if ((always || score >= 1 || !matchable) && used + block.length + 2 <= budget) {
      lines.push('', block);
      used += block.length + 2;
    } else skipped.push(e);
  }
  if (skipped.length) {
    lines.push(
      '',
      `More knowledge for this site (call site_knowledge with a topic to read one): ${skipped.map((e) => `“${e.title}”`).join(', ')}. Before doing one of these here, read it — it is how this site does it.`,
    );
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
