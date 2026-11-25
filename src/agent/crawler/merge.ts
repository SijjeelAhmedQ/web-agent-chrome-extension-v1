import type { AppConfig, CrawledPage, KnowledgeBase, KnowledgeEntry, KnowledgeKind } from '@/shared/types/config';
import { matchesSite, uid } from '@/shared/utils';

/**
 * Knowledge the crawler proposes, before the user reviews it. `selected` is the user's tick; `update` says an entry
 * of the same kind and title is in the knowledge base already (saving replaces its text).
 */
export interface ProposedEntry {
  id: string;
  kind: KnowledgeKind;
  title: string;
  content: string;
  trigger?: string;
  /** The page it was learned on. */
  source: string;
  selected: boolean;
  update?: boolean;
}

const normTitle = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const entryKey = (kind: KnowledgeKind, title: string) => `${kind}:${normTitle(title)}`;

/** The gathered knowledge base for this address, if there is one that is on. */
export function knowledgeBaseFor(config: Pick<AppConfig, 'knowledgeBases'>, url: string): KnowledgeBase | undefined {
  if (!url) return undefined;
  return (config.knowledgeBases ?? []).find((kb) => kb.enabled && kb.sites.length > 0 && matchesSite(url, kb.sites));
}

/** The host a crawl of this address is about (no `www.`). */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function newKnowledgeBase(startUrl: string, name?: string, now = Date.now()): KnowledgeBase {
  const host = hostOf(startUrl);
  return { id: uid('kbase_'), name: name || host || 'Website', sites: host ? [host] : [], startUrl, enabled: true, entries: [], neverClick: [], pages: [], createdAt: now, updatedAt: now };
}

/** Words a model adds to a title that don't change what it is about (“Sidebar toggle behavior” is “Sidebar toggle”). */
const FILLER = new Set(['the', 'a', 'an', 'of', 'and', 'on', 'in', 'to', 'for', 'behavior', 'behaviour', 'how', 'works', 'rule', 'rules', 'note', 'notes']);
const topicWords = (title: string) => new Set(normTitle(title).split(' ').filter((w) => w && !FILLER.has(w)).map((w) => (w.length > 3 ? w.replace(/s$/, '') : w)));

/** Two titles about the same thing: the same words, give or take filler and plurals (or nearly all of them). */
export function sameTopic(a: string, b: string): boolean {
  if (normTitle(a) === normTitle(b)) return true;
  const x = topicWords(a);
  const y = topicWords(b);
  if (!x.size || !y.size) return false;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both) >= 0.75;
}

/** Lines of `extra` that `base` does not have yet, appended to it. */
function joinContent(base: string, extra: string): string {
  const have = new Set(base.split('\n').map((l) => l.trim().toLowerCase()).filter(Boolean));
  const add = extra.split('\n').filter((l) => l.trim() && !have.has(l.trim().toLowerCase()));
  return add.length ? `${base.trim()}\n${add.join('\n')}` : base;
}

/**
 * Adds new proposals to the list so far: the same kind and title is one entry (its text grows with lines it did not
 * have). Marks which ones update an entry of the knowledge base.
 */
export function addProposals(list: ProposedEntry[], incoming: Omit<ProposedEntry, 'id' | 'selected' | 'update'>[], existing: KnowledgeEntry[] = []): ProposedEntry[] {
  const out = [...list];
  const have = new Set(existing.map((e) => entryKey(e.kind, e.title)));
  for (const p of incoming) {
    if (!p.title.trim() || !p.content.trim()) continue;
    const key = entryKey(p.kind, p.title);
    const i = out.findIndex((o) => o.kind === p.kind && sameTopic(o.title, p.title));
    if (i >= 0) {
      out[i] = { ...out[i], content: joinContent(out[i].content, p.content), trigger: out[i].trigger || p.trigger };
    } else {
      out.push({ ...p, title: p.title.trim(), content: p.content.trim(), id: uid('prop_'), selected: true, ...(have.has(key) ? { update: true } : {}) });
    }
  }
  return out;
}

/**
 * Saves what the user ticked: an entry with the same kind and title gets the new text (it keeps its id and its
 * on/off), new ones are added, and every other entry stays as it was. Never-click names and pages are added.
 */
export function mergeIntoBase(kb: KnowledgeBase, chosen: ProposedEntry[], neverClick: string[], pages: CrawledPage[], now = Date.now()): { kb: KnowledgeBase; added: number; updated: number } {
  const entries = [...kb.entries];
  let added = 0;
  let updated = 0;
  for (const p of chosen) {
    const key = entryKey(p.kind, p.title);
    const i = entries.findIndex((e) => entryKey(e.kind, e.title) === key);
    const fields = { kind: p.kind, title: p.title.trim(), content: p.content.trim(), ...(p.kind === 'workflow' ? { trigger: p.trigger?.trim() ?? '' } : {}) };
    if (i >= 0) {
      if (entries[i].content.trim() !== fields.content || (entries[i].trigger ?? '') !== (fields.trigger ?? '')) updated++;
      entries[i] = { ...entries[i], ...fields, updatedAt: now };
    } else {
      entries.push({ id: uid('kb_'), ...fields, enabled: true, createdAt: now, updatedAt: now });
      added++;
    }
  }
  const never = [...kb.neverClick];
  for (const n of neverClick.map((x) => x.trim()).filter(Boolean)) if (!never.some((x) => x.toLowerCase() === n.toLowerCase())) never.push(n);
  const seen = new Set(kb.pages.map((p) => p.url));
  const allPages = [...kb.pages, ...pages.filter((p) => !seen.has(p.url))].slice(-500);
  return { kb: { ...kb, entries, neverClick: never, pages: allPages, lastCrawlAt: now, updatedAt: now }, added, updated };
}
