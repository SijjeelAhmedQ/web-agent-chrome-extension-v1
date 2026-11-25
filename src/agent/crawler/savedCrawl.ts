import type { CrawlState } from './crawlRun';

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
};

const PREFIX = 'wa.crawl.';
const keyOf = (host: string) => `${PREFIX}${host.toLowerCase()}`;

export async function saveCrawl(c: SavedCrawl): Promise<void> {
  if (!c.host) return;
  await chrome.storage.local.set({ [keyOf(c.host)]: c });
}

export async function loadSavedCrawl(host: string): Promise<SavedCrawl | null> {
  if (!host) return null;
  const r = await chrome.storage.local.get(keyOf(host));
  const c = r[keyOf(host)] as SavedCrawl | undefined;
  return c && Array.isArray(c.captures) && c.captures.length ? c : null;
}

export async function deleteSavedCrawl(host: string): Promise<void> {
  if (host) await chrome.storage.local.remove(keyOf(host));
}
