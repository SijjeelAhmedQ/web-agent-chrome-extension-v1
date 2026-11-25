import { getItem, removeItem, setItem } from '@/shared/storage/storage';
import type { CrawlerSettings, KnowledgeBase } from '@/shared/types/config';
import type { CrawlState, ExploreState } from './crawlRun';

/**
 * A crawl kept in the browser's storage while it runs, so nothing read or written is lost when the side panel
 * closes or the extension reloads: one per site (its latest), until its knowledge is saved or the user discards it.
 */
export type SavedCrawl = Pick<CrawlState, 'id' | 'host' | 'siteName' | 'startUrl' | 'model' | 'phase' | 'pagesDone' | 'captures' | 'pages' | 'proposals' | 'neverClick' | 'otherSites' | 'spent' | 'startedAt'> & {
  /** Pages already written up (url | title), so writing goes on with the rest. */
  written: string[];
  /** Notes for the site's rules (a session that ended…). */
  notes: string[];
  savedAt: number;
  /** Where exploring was (its queue, the pages and controls already done): opened again, it carries on from there. */
  explore?: ExploreState;
  /** The site's knowledge base as it was when the crawl began — what is learned is saved into it as it goes. */
  base?: KnowledgeBase | null;
  /** Learning the site again from scratch: the old entries go when the user saves. */
  mode?: 'update' | 'replace';
  /** What was chosen for this crawl when it started (time and page limit, running on its own, model): kept on carrying on. */
  overrides?: Partial<CrawlerSettings>;
};

const PREFIX = 'wa.crawl.';
const keyOf = (host: string) => `${PREFIX}${host.toLowerCase()}`;

export async function saveCrawl(c: SavedCrawl): Promise<void> {
  if (!c.host) return;
  await setItem(keyOf(c.host), c);
}

export async function loadSavedCrawl(host: string): Promise<SavedCrawl | null> {
  if (!host) return null;
  const c = await getItem<SavedCrawl>(keyOf(host));
  // One with pages read, or (stopped during its first page) a way through the site to carry on with.
  return c && Array.isArray(c.captures) && (c.captures.length || c.explore?.queue.length || c.explore?.visiting) ? c : null;
}

export async function deleteSavedCrawl(host: string): Promise<void> {
  if (host) await removeItem(keyOf(host));
}
