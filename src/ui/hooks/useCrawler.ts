import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'react-redux';
import { CrawlRun, type CrawlAnswer, type CrawlState, type OtherSite } from '@/agent/crawler/crawlRun';
import { hostOf, mergeIntoBase, newKnowledgeBase, type ProposedEntry } from '@/agent/crawler/merge';
import { deleteSavedCrawl, type SavedCrawl } from '@/agent/crawler/savedCrawl';
import type { CrawlerSettings, KnowledgeBase } from '@/shared/types/config';
import { matchesSite } from '@/shared/utils';
import { useAppDispatch, type AppStore } from '@/store';
import { configActions } from '@/store/configSlice';
import type { ActiveTab } from './useActiveTab';

/** The gathered knowledge base of this host, on or off. */
export function baseOfHost(bases: KnowledgeBase[] | undefined, url: string): KnowledgeBase | undefined {
  url = url && !/^[a-z]+:\/\//i.test(url) ? `https://${url}` : url;
  const host = hostOf(url);
  if (!host) return undefined;
  return (bases ?? []).find((kb) => kb.sites.some((s) => s.toLowerCase() === host) || matchesSite(url, kb.sites));
}

export interface SaveResult {
  added: number;
  updated: number;
  name: string;
  /** Old entries deleted (learning the site again from scratch). */
  replaced: number;
}

/** Learning a site again: update its knowledge base (keep, add, update), or replace it. */
export type LearnMode = 'update' | 'replace';

/**
 * Runs the Knowledge Gather Agent from the side panel and keeps its state while the panel switches views.
 * Saving merges the ticked entries into the site's gathered knowledge base (made when there is none).
 */
export function useCrawler(tab: ActiveTab) {
  const store = useStore() as AppStore;
  const dispatch = useAppDispatch();
  const runRef = useRef<CrawlRun | null>(null);
  const [state, setState] = useState<CrawlState | null>(null);
  const [saved, setSaved] = useState<SaveResult | null>(null);
  const modeRef = useRef<LearnMode>('update');

  useEffect(() => () => runRef.current?.cancel(), []);

  const start = useCallback(
    async (startUrl: string, overrides: Partial<CrawlerSettings>, tabId: number | null = tab.id, mode: LearnMode = 'update') => {
      if (runRef.current && ['exploring', 'paused', 'explored', 'writing'].includes(runRef.current.snapshot.phase)) return;
      const { config } = store.getState().config;
      const chat = store.getState().chat;
      if (tab.windowId === null) return;
      const agent = config.agents.find((a) => a.id === (chat.activeAgentId ?? config.settings.defaultAgentId)) ?? config.agents[0];
      setSaved(null);
      modeRef.current = mode;
      const run = new CrawlRun({
        config,
        agent,
        windowId: tab.windowId,
        tabId,
        startUrl,
        // Starting fresh: nothing of the old knowledge base counts (it is replaced on saving).
        existing: mode === 'replace' ? undefined : baseOfHost(config.knowledgeBases, startUrl || tab.url),
        overrides,
        onState: (s) => {
          if (runRef.current === run) setState(s);
        },
      });
      runRef.current = run;
      setState(run.snapshot);
      await run.start();
    },
    [store, tab.id, tab.url, tab.windowId],
  );

  const save = useCallback((): SaveResult | null => {
    const run = runRef.current;
    if (!run) return null;
    const s = run.snapshot;
    const { config } = store.getState().config;
    const old = baseOfHost(config.knowledgeBases, s.startUrl);
    // “Start fresh”: the old entries, never-click names and pages go; its name and addresses stay.
    const base = old ? (modeRef.current === 'replace' ? { ...old, entries: [], neverClick: [], pages: [] } : old) : newKnowledgeBase(s.startUrl, s.siteName);
    const chosen = s.proposals.filter((p) => p.selected);
    const { kb, added, updated } = mergeIntoBase(base, chosen, s.neverClick, s.pages);
    dispatch(configActions.upsertKnowledgeBase(kb));
    dispatch(configActions.adoptKnowledgeBase(kb.id));
    // Saved into the knowledge base: the copy kept while it ran is no longer needed.
    void deleteSavedCrawl(s.host).catch(() => undefined);
    const result = { added, updated, name: kb.name, replaced: modeRef.current === 'replace' && !!old ? old.entries.length : 0 };
    setSaved(result);
    return result;
  }, [dispatch, store]);

  /** A crawl kept in storage (the panel closed, the extension reloaded), opened again where it was. */
  const restore = useCallback(
    async (saved: SavedCrawl) => {
      if (runRef.current && ['exploring', 'paused', 'explored', 'writing'].includes(runRef.current.snapshot.phase)) return;
      const { config } = store.getState().config;
      const chat = store.getState().chat;
      if (tab.windowId === null) return;
      const agent = config.agents.find((a) => a.id === (chat.activeAgentId ?? config.settings.defaultAgentId)) ?? config.agents[0];
      setSaved(null);
      modeRef.current = 'update';
      const run = new CrawlRun({
        config,
        agent,
        windowId: tab.windowId,
        tabId: tab.id,
        startUrl: saved.startUrl,
        existing: baseOfHost(config.knowledgeBases, saved.startUrl),
        onState: (s) => {
          if (runRef.current === run) setState(s);
        },
      });
      runRef.current = run;
      setState(run.snapshot);
      await run.restore(saved);
    },
    [store, tab.id, tab.windowId],
  );

  /** The user throws the crawl away: its kept copy goes too. */
  const discard = useCallback(() => {
    const host = runRef.current?.snapshot.host;
    if (host) void deleteSavedCrawl(host).catch(() => undefined);
    runRef.current?.cancel();
    runRef.current = null;
    setState(null);
    setSaved(null);
  }, []);

  const reset = useCallback(() => {
    runRef.current?.cancel();
    runRef.current = null;
    setState(null);
    setSaved(null);
  }, []);

  /** Crawls a site another one opened in a new tab: its own knowledge base and page limit. */
  const learnOther = useCallback(
    async (site: OtherSite, overrides: Partial<CrawlerSettings>) => {
      runRef.current = null;
      setState(null);
      if (site.tabId !== null) {
        const t = await chrome.tabs.get(site.tabId).catch(() => null);
        if (t) {
          await chrome.tabs.update(site.tabId, { active: true }).catch(() => undefined);
          return start('', overrides, site.tabId);
        }
      }
      return start(site.url, overrides);
    },
    [start],
  );

  return {
    state,
    saved,
    start,
    save,
    reset,
    restore,
    discard,
    learnOther,
    pause: () => runRef.current?.pause(),
    resume: () => runRef.current?.resume(),
    stop: () => runRef.current?.stop(),
    cancel: () => runRef.current?.cancel(),
    answer: (id: string, a: CrawlAnswer) => runRef.current?.answer(id, a),
    write: () => runRef.current?.write(),
    setProposals: (p: ProposedEntry[]) => runRef.current?.setProposals(p),
    setNeverClick: (n: string[]) => runRef.current?.setNeverClick(n),
    active: !!state && ['exploring', 'paused', 'explored', 'writing'].includes(state.phase),
  };
}
