import type { KnowledgeEntry, KnowledgeKind, SiteProfile } from '@/shared/types/config';

/**
 * Turns a site's knowledge base into the part of the system prompt the agent reads on that
 * site. What matches the request goes first (its rules, pages and workflows), then the site's
 * navigation, pages and other rules while they fit; workflows that don't match are listed by
 * title, for site_knowledge to read when the task needs one. The prompt goes with every call of a task:
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

/** One letter wrong, missing or extra, or two side by side swapped: “shwo” is “show”, “reocrd” is “record”. */
export function oneSlip(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const diff: number[] = [];
    for (let i = 0; i < a.length && diff.length <= 2; i++) if (a[i] !== b[i]) diff.push(i);
    if (diff.length === 1) return true;
    return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  return short.slice(i) === long.slice(i + 1);
}

/**
 * The request's words with typos put right: a word of four letters or more that no entry has, and that is one slip
 * from a word an entry has, is that word. A word the knowledge has (“fill”) stays itself, even one slip from another (“file”).
 */
export function corrected(asked: Set<string>, entries: KnowledgeEntry[]): Set<string> {
  const known = new Set(entries.flatMap((e) => [...wordsOf(`${e.title} ${e.trigger ?? ''} ${e.content}`)]));
  return new Set(
    [...asked].map((w) => {
      if (w.length < 4 || known.has(w)) return w;
      return [...known].find((k) => k.length >= 4 && oneSlip(w, k)) ?? w;
    }),
  );
}

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
 * (16k tokens → ~9k characters), never less than 3,000 or more than 16,000.
 */
export function knowledgeBudget(contextTokens: number | undefined): number {
  // No limit given: a cloud model, paid for every token of every call — what the request needs, not the site's
  // whole knowledge (the rest is a site_knowledge call away).
  if (!contextTokens) return MAX_KNOWLEDGE;
  // A small context (Kaggle's 16K) also holds the tools, the instructions and every step: knowledge gets less of it.
  const share = contextTokens <= 32_768 ? 0.55 : 0.8;
  return Math.min(MAX_KNOWLEDGE, Math.max(3_000, Math.round(contextTokens * share)));
}
/** Characters of site knowledge in a prompt at most (was 48,000: Indici's whole knowledge, with every call). */
const MAX_KNOWLEDGE = 16_000;

/** The prompt section for the sites the agent is on, within about `budget` characters. */
export function knowledgeSection(profiles: SiteProfile[], request: string, budget = 12_000, small = false): { text: string; left: number } {
  const entries = activeKnowledge(profiles);
  if (!entries.length && !profiles.some((p) => p.neverClick?.length)) return { text: '', left: 0 };
  // What the request is about goes in first: entries whose title (or example) shares a word with it — its rules
  // and pages, then its workflows, best match first — then the entries those name (“Handle the pop-ups as the
  // "Pop-ups when a consult opens" rule says”), then the site's navigation and other rules while there is room.
  // Words only in an entry's text don't make it a match: “task” or “patient” is in half a site's entries.
  // (All rules first filled a small model's room — Kaggle's 9,000 characters — before “goto patients” got its workflow.)
  const asked = corrected(wordsOf(request), entries);
  // An example's words in two or more examples are sample values (“arya stark”, “aqib”), not what it is about.
  const inExamples = new Map<string, number>();
  for (const e of entries) for (const w of wordsOf(e.trigger ?? '')) inExamples.set(w, (inExamples.get(w) ?? 0) + 1);
  const topicWords = (e: KnowledgeEntry) => new Set([...wordsOf(e.title), ...[...wordsOf(e.trigger ?? '')].filter((w) => (inExamples.get(w) ?? 0) < 2)]);
  const hits = (e: KnowledgeEntry) => [...topicWords(e)].filter((w) => asked.has(w));
  // A word in the titles of many entries (“record”, “this patient”) doesn't say which: while another word of the
  // request does, an entry that shares only such words is no match — “add a task against this record” pulled in
  // eleven workflows, with every call.
  const inTopics = new Map<string, number>();
  for (const e of entries) for (const w of topicWords(e)) inTopics.set(w, (inTopics.get(w) ?? 0) + 1);
  const common = (w: string) => (inTopics.get(w) ?? 0) > Math.max(3, entries.length * 0.15);
  const anySpecific = entries.some((e) => hits(e).some((w) => !common(w)));
  const scored = entries.map((e) => {
    const h = hits(e);
    return {
      e,
      score: h.length * 2 + [...wordsOf(e.content)].filter((w) => asked.has(w)).length * 0.5,
      match: anySpecific ? h.some((w) => !common(w)) : h.length > 0,
      named: false,
    };
  });
  const named = (title: string, text: string) => {
    const head = title.split(' — ')[0].trim();
    return head.length > 8 && text.includes(head);
  };
  const matching = scored.filter((s) => s.match).map((s) => s.e.content);
  for (const s of scored) if (!s.match && matching.some((text) => named(s.e.title, text))) s.named = true;
  // Then, while there is room: navigation, pages (how the site's screens work), rules; other workflows by title.
  // The workflow the request is most about, then what it names, then the other matches: a small model's room goes
  // to them in that order.
  const bestMatch = scored.filter((s) => s.match && s.e.kind === 'workflow').sort((a, b) => b.score - a.score)[0];
  const namedByBest = (s: (typeof scored)[number]) => !!bestMatch && s.named && named(s.e.title, bestMatch.e.content);
  const tier = (s: (typeof scored)[number]) =>
    s === bestMatch ? 1 : namedByBest(s) ? 1.2 : s.match ? (s.e.kind === 'workflow' ? 1.5 : 0) : s.named ? 2 : s.e.kind === 'navigation' ? 3 : s.e.kind === 'page' ? 4 : s.e.kind === 'rule' ? 5 : 6;
  const ranked = scored.sort((a, b) => tier(a) - tier(b) || (tier(a) === 1.5 ? 0 : ORDER.indexOf(a.e.kind) - ORDER.indexOf(b.e.kind)) || b.score - a.score);
  const names = profiles.map((p) => p.name).join(', ');
  const lines = [
    `## What the user has taught you about ${names}`,
    "This comes from the user and is correct for this website. Follow it over your own guesses. When a workflow matches the request, follow its steps in order. What is below is complete: don't call site_knowledge for anything shown here.",
  ];
  const never = [...new Set(profiles.flatMap((p) => p.neverClick ?? []).map((n) => n.trim()).filter(Boolean))];
  if (never.length) {
    lines.push('', `### Rule: Buttons you never click here`, `The user clicks these themselves: ${never.map((n) => `“${n}”`).join(', ')}. When everything before them is done, stop and tell the user it is ready.`);
  }
  let used = lines.join('\n').length;
  const skipped: KnowledgeEntry[] = [];
  // A request with words to match: workflows that don't match (nor are named by one that does) wait for site_knowledge.
  // A small task (only clicks) gets what matches and the site's navigation: other rules and pages wait there too.
  const matchable = asked.size > 0 || small;
  // Room is kept for the workflow the request is most about: a small model's room went to matching rules first.
  const best = bestMatch?.e;
  let held = best ? formatEntry(best).length + 2 : 0;
  if (used + held > budget) held = 0;
  for (const { e, match, named: isNamed } of ranked) {
    const block = formatEntry(e);
    const always = small ? e.kind === 'navigation' : e.kind !== 'workflow';
    if (e === best) held = 0;
    if ((always || match || isNamed || !matchable) && used + block.length + 2 + held <= budget) {
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
