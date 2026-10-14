import type { KnowledgeEntry, KnowledgeKind, SiteProfile } from '@/shared/types/config';
import { KNOWLEDGE_KINDS } from './siteKnowledge';

/**
 * A site's knowledge base as plain text — the same `### Kind: Title` blocks the agent reads —
 * so it can be copied, edited, pasted and turned back into entries.
 *
 *   ### Rule: Open a patient by clicking the name
 *   Patient names are plain text …
 *
 *   ### Workflow (off): Add a medication
 *   For requests like: “add medication …”
 *   1. …
 */

export interface ParsedEntry {
  kind: KnowledgeKind;
  title: string;
  trigger?: string;
  content: string;
  enabled: boolean;
}

export interface ParsedKnowledge {
  entries: ParsedEntry[];
  /** From a “### Rule: Buttons you never click here” block; null when the text has none. */
  neverClick: string[] | null;
  /** `###` headings whose kind isn't Rule, Navigation, Page or Workflow. */
  unknown: string[];
}

export const NEVER_CLICK_TITLE = 'Buttons you never click here';
const ORDER: KnowledgeKind[] = ['rule', 'navigation', 'page', 'workflow'];

const KIND_WORDS: Record<string, KnowledgeKind> = {
  rule: 'rule',
  rules: 'rule',
  navigation: 'navigation',
  nav: 'navigation',
  page: 'page',
  pages: 'page',
  'page & controls': 'page',
  'page and controls': 'page',
  controls: 'page',
  workflow: 'workflow',
  workflows: 'workflow',
};

const key = (kind: string, title: string) => `${kind}|${title.toLowerCase().replace(/\s+/g, ' ').trim()}`;

/** The whole knowledge base (switched-off entries too, marked “(off)”) and the never-click list. */
export function knowledgeAsText(site: Pick<SiteProfile, 'knowledge' | 'neverClick'>): string {
  const blocks: string[] = [];
  const never = (site.neverClick ?? []).map((n) => n.trim()).filter(Boolean);
  if (never.length) blocks.push(`### Rule: ${NEVER_CLICK_TITLE}\nThe user clicks these themselves: ${never.map((n) => `“${n}”`).join(', ')}.`);
  const entries = [...site.knowledge].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  for (const e of entries) {
    const head = `### ${KNOWLEDGE_KINDS[e.kind].heading}${e.enabled ? '' : ' (off)'}: ${e.title.trim()}`;
    const example = e.kind === 'workflow' && e.trigger?.trim() ? `For requests like: “${e.trigger.trim()}”\n` : '';
    blocks.push(`${head}\n${example}${e.content.trim()}`);
  }
  return blocks.join('\n\n');
}

/** Reads `### Kind: Title` blocks back into entries. Anything before the first block is ignored. */
export function parseKnowledgeText(text: string): ParsedKnowledge {
  const entries: ParsedEntry[] = [];
  const unknown: string[] = [];
  let neverClick: string[] | null = null;
  let cur: (ParsedEntry & { lines: string[] }) | null = null;

  const flush = () => {
    if (!cur) return;
    const content = cur.lines.join('\n').trim();
    if (cur.kind === 'rule' && cur.title.toLowerCase() === NEVER_CLICK_TITLE.toLowerCase()) {
      neverClick = [...content.matchAll(/[“"]([^”"]+)[”"]/g)].map((m) => m[1].trim()).filter(Boolean);
    } else if (cur.title || content) {
      const { lines: _lines, ...entry } = cur;
      entries.push({ ...entry, content });
    }
    cur = null;
  };

  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = /^\s*###\s+([^:(]+?)\s*(\((off|disabled)\))?\s*:\s*(.*)$/i.exec(line);
    if (heading) {
      flush();
      const kind = KIND_WORDS[heading[1].toLowerCase().trim()];
      if (!kind) {
        unknown.push(line.trim());
        continue;
      }
      cur = { kind, title: heading[4].trim(), content: '', enabled: !heading[2], lines: [] };
      continue;
    }
    // The preview's own header and footer lines.
    if (/^\s*##\s/.test(line) || /^More knowledge for this site/i.test(line.trim())) {
      flush();
      continue;
    }
    if (!cur) continue;
    const example = /^\s*For requests like:\s*[“"']?(.*?)[”"']?\s*$/i.exec(line);
    if (cur.kind === 'workflow' && cur.trigger === undefined && !cur.lines.some((l) => l.trim()) && example) {
      cur.trigger = example[1].trim();
      continue;
    }
    cur.lines.push(line);
  }
  flush();
  return { entries, neverClick, unknown };
}

export interface KnowledgeMerge {
  knowledge: KnowledgeEntry[];
  added: number;
  updated: number;
  removed: number;
  /** Entries not in the text (kept unless `removeMissing`). */
  missing: number;
}

/** Applies parsed entries: same kind + title → updated, new → added; the rest kept or removed. */
export function mergeKnowledge(existing: KnowledgeEntry[], parsed: ParsedEntry[], removeMissing: boolean, newId: () => string, now = Date.now()): KnowledgeMerge {
  const byKey = new Map(existing.map((e) => [key(e.kind, e.title), e]));
  const seen = new Set<string>();
  const out: KnowledgeEntry[] = [];
  let added = 0;
  let updated = 0;
  for (const p of parsed) {
    const k = key(p.kind, p.title);
    if (seen.has(k)) continue;
    seen.add(k);
    const old = byKey.get(k);
    const next: KnowledgeEntry = {
      id: old?.id ?? newId(),
      kind: p.kind,
      title: p.title,
      content: p.content,
      ...(p.kind === 'workflow' ? { trigger: p.trigger ?? old?.trigger ?? '' } : {}),
      enabled: p.enabled,
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
    };
    if (!old) added++;
    else if (old.content.trim() !== next.content || (old.trigger ?? '') !== (next.trigger ?? '') || old.enabled !== next.enabled) updated++;
    out.push(old && old.content.trim() === next.content && (old.trigger ?? '') === (next.trigger ?? '') && old.enabled === next.enabled ? old : next);
  }
  const rest = existing.filter((e) => !seen.has(key(e.kind, e.title)));
  return { knowledge: removeMissing ? out : [...out, ...rest], added, updated, removed: removeMissing ? rest.length : 0, missing: rest.length };
}
