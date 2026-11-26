import type { KnowledgeBase, KnowledgeEntry } from '../types/config';
import { normalizeSpeech } from './commands';

/**
 * “Open stations”, “go to messages”: a spoken request only to go to a page the knowledge base knows. The page's
 * address comes from the site's map (the pages a crawl visited and its “How to reach …” entries), so the tab goes
 * there at once — no model call. Anything more than going there (“open Brian Dooley”, “open stations and add one”)
 * is not matched and goes to the agent as usual.
 */

export interface NavTarget {
  /** What the page is called, as said: “stations”, “practice members”. */
  name: string;
  /** Its address on the site: “/mentor-dashboard/layout”. */
  path: string;
  /** How the answer names it: “Stations”. */
  label: string;
}

const cleanName = (raw: string) =>
  normalizeSpeech(raw)
    .replace(/^(the|a|an)\s+/, '')
    .replace(/\s+(page|screen|tab|section|view)$/, '')
    .trim();

/** The first address an entry gives: “Address: /tags”, “Address path: /messages”, “(path /patients)”. */
function pathOf(text: string): string | null {
  const said = text.match(/\b(?:address(?: path)?|path|url)\s*:?\s*`?(\/[^\s`,;)"]*)/i)?.[1];
  return said ? said.replace(/[.,;)]+$/, '') || '/' : null;
}

/** The pages of a knowledge base one can be taken to: from its crawled pages, then its “How to reach X” entries. */
export function navTargets(kb: Pick<KnowledgeBase, 'pages' | 'entries'>): NavTarget[] {
  const out: NavTarget[] = [];
  const add = (label: string, path: string) => {
    const name = cleanName(label);
    if (!name || !path.startsWith('/') || /[:#*]/.test(path)) return;
    if (out.some((t) => t.name === name)) return;
    out.push({ name, path, label: label.trim().replace(/\s+page$/i, '') });
  };
  for (const p of kb.pages ?? []) {
    // “Stations · Octans” → Stations; a screen inside a page (“… › Dobson Wing”) is not a page of its own.
    if (p.template.includes('#') || p.title.includes('›')) continue;
    add(p.title.split(/\s+[·|–—-]\s+/)[0], p.template);
  }
  for (const e of (kb.entries ?? []) as KnowledgeEntry[]) {
    if (e.kind !== 'navigation' || !e.enabled) continue;
    const m = e.title.match(/^how to (?:reach|open|get to|find)\s+(.+)$/i);
    const path = m && pathOf(e.content);
    if (m && path) add(m[1].replace(/^the\s+/i, ''), path);
  }
  return out;
}

const VERB = /^(?:please\s+)?(?:open|go to|goto|go back to|show(?: me)?|take me to|navigate to|switch to|bring up)\s+(?:the\s+)?(.+?)(?:\s+please)?$/;
// Roman Urdu / Hindi: “stations kholo”, “messages par jao”, “tags dikhao”.
const VERB_AFTER = /^(.+?)\s+(?:kholo|khol do|kholein|par jao|pe jao|pr jao|dikhao|dikha do|open karo|open kro|open kar do)$/;

const singular = (s: string) => s.replace(/(?<=\w{3})s$/, '');

/** The page a spoken request asks to go to, when that is all it asks. */
export function matchNavigation(text: string, targets: NavTarget[]): NavTarget | null {
  const t = normalizeSpeech(text);
  const asked = (t.match(VERB)?.[1] ?? t.match(VERB_AFTER)?.[1])?.trim();
  if (!asked) return null;
  const name = cleanName(asked);
  if (!name) return null;
  return targets.find((x) => x.name === name) ?? targets.find((x) => singular(x.name) === singular(name)) ?? null;
}
