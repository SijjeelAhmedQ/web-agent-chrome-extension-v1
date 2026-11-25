import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'react-redux';
import { CrawlRun, type CrawlAnswer, type CrawlState, type OtherSite } from '@/agent/crawler/crawlRun';
import { hostOf, mergeIntoBase, newKnowledgeBase, type ProposedEntry } from '@/agent/crawler/merge';
import { deleteSavedCrawl, type SavedCrawl } from '@/agent/crawler/savedCrawl';
import { crawlerSettings } from '@/shared/constants/defaults';
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

const withScheme = (url: string) => (url && !/^[a-z]+:\/\//i.test(url) ? `https://${url}` : url);

/** A crawl's own new knowledge base (the site had none): its id follows the crawl's, so opening the crawl again finds it. */
const freshBase = (startUrl: string, crawlId: string): KnowledgeBase => ({ ...newKnowledgeBase(withScheme(startUrl)), id: `kbase_${crawlId.replace(/^crawl_/, '')}` });

/** How often what was learned is saved into the knowledge base while the crawl runs. */
const AUTOSAVE_MS = 1500;

/**
 * Runs the Knowledge Gather Agent from the side panel and keeps its state while the panel switches views.
 *
 * What it learns goes into the site's knowledge base as it goes (the crawler setting “save as it goes”, on by
 * default): each time entries are written, the base as it was when the crawl began, plus every ticked entry, is
 * saved — so nothing is lost when the panel closes or nobody presses Save, and the site and its agent are there at
 * once. Saving at the end does the same with the user's ticks; discarding puts the base back as it was.
 */
export function useCrawler(tab: ActiveTab) {
  const store = useStore() as AppStore;
  const dispatch = useAppDispatch();
  const runRef = useRef<CrawlRun | null>(null);
  const [state, setState] = useState<CrawlState | null>(null);
  const [saved, setSaved] = useState<SaveResult | null>(null);
  const modeRef = useRef<LearnMode>('update');
  /** The knowledge base as it was when the crawl began (or the new one it makes), and whether it was there before. */
  const baseRef = useRef<{ kb: KnowledgeBase; existed: boolean } | null>(null);
  const autoRef = useRef<{ on: boolean; timer: ReturnType<typeof setTimeout> | null; last: string; adopted: boolean }>({ on: true, timer: null, last: '', adopted: false });

  useEffect(
    () => () => {
      runRef.current?.cancel();
      if (autoRef.current.timer) clearTimeout(autoRef.current.timer);
    },
    [],
  );

  /** The knowledge base with what was learned: the base it began with, plus the ticked entries. */
  const merged = useCallback((s: CrawlState, final: boolean) => {
    const base = baseRef.current!.kb;
    // “Start fresh”: the old entries go only when the user saves — until then they stay, in case the crawl is dropped.
    const from = final && modeRef.current === 'replace' ? { ...base, entries: [], neverClick: [], pages: [] } : base;
    return mergeIntoBase(from, s.proposals.filter((p) => p.selected), s.neverClick, s.pages);
  }, []);

  /** Saves what is learned so far into the knowledge base (and, the first time, makes the site and its agent). */
  const autosave = useCallback(() => {
    const auto = autoRef.current;
    auto.timer = null;
    const run = runRef.current;
    if (!run || !baseRef.current || !auto.on) return;
    const s = run.snapshot;
    if (!s.proposals.length || s.phase === 'cancelled' || s.phase === 'failed') return;
    const sig = `${s.proposals.length}|${s.proposals.reduce((n, p) => n + p.content.length + (p.selected ? 1 : 0) + p.title.length, 0)}|${s.neverClick.length}|${s.pages.length}`;
    if (sig === auto.last) return;
    auto.last = sig;
    const { kb } = merged(s, false);
    dispatch(configActions.upsertKnowledgeBase(kb));
    if (!auto.adopted) {
      dispatch(configActions.adoptKnowledgeBase(kb.id));
      auto.adopted = true;
    }
  }, [dispatch, merged]);

  const watch = useCallback(
    (run: CrawlRun) => (s: CrawlState) => {
      if (runRef.current !== run) return;
      setState(s);
      const auto = autoRef.current;
      if (auto.on && !auto.timer && s.proposals.length) auto.timer = setTimeout(autosave, AUTOSAVE_MS);
    },
    [autosave],
  );

  const begin = (on: boolean) => {
    if (autoRef.current.timer) clearTimeout(autoRef.current.timer);
    autoRef.current = { on, timer: null, last: '', adopted: false };
  };

  const start = useCallback(
    async (startUrl: string, overrides: Partial<CrawlerSettings>, tabId: number | null = tab.id, mode: LearnMode = 'update') => {
      if (runRef.current && ['exploring', 'paused', 'explored', 'writing'].includes(runRef.current.snapshot.phase)) return;
      const { config } = store.getState().config;
      const chat = store.getState().chat;
      if (tab.windowId === null) return;
      const agent = config.agents.find((a) => a.id === (chat.activeAgentId ?? config.settings.defaultAgentId)) ?? config.agents[0];
      setSaved(null);
      modeRef.current = mode;
      const address = startUrl.trim() || tab.url;
      const old = baseOfHost(config.knowledgeBases, address);
      begin({ ...crawlerSettings(config.settings), ...overrides }.saveAsItGoes);
      let run: CrawlRun | null = null;
      run = new CrawlRun({
        config,
        agent,
        windowId: tab.windowId,
        tabId,
        startUrl,
        // Starting fresh: nothing of the old knowledge base counts (it is replaced on saving).
        existing: mode === 'replace' ? undefined : old,
        overrides,
        base: old ?? null,
        mode,
        onState: (s) => run && watch(run)(s),
      });
      baseRef.current = { kb: old ?? freshBase(address, run.snapshot.id), existed: !!old };
      runRef.current = run;
      setState(run.snapshot);
      await run.start();
    },
    [store, tab.id, tab.url, tab.windowId, watch],
  );

  const save = useCallback((): SaveResult | null => {
    const run = runRef.current;
    if (!run || !baseRef.current) return null;
    const s = run.snapshot;
    if (autoRef.current.timer) clearTimeout(autoRef.current.timer);
    autoRef.current.timer = null;
    const old = baseRef.current.existed ? baseRef.current.kb : undefined;
    const { kb, added, updated } = merged(s, true);
    dispatch(configActions.upsertKnowledgeBase(kb));
    dispatch(configActions.adoptKnowledgeBase(kb.id));
    autoRef.current.adopted = true;
    // Saved into the knowledge base: the copy kept while it ran is no longer needed (and is not kept again).
    run.stopKeeping();
    void deleteSavedCrawl(s.host).catch(() => undefined);
    const result = { added, updated, name: kb.name, replaced: modeRef.current === 'replace' && !!old ? old.entries.length : 0 };
    setSaved(result);
    return result;
  }, [dispatch, merged]);

  /** A crawl kept in storage (the panel closed, the extension reloaded), opened again where it was. */
  const restore = useCallback(
    async (kept: SavedCrawl) => {
      if (runRef.current && ['exploring', 'paused', 'explored', 'writing'].includes(runRef.current.snapshot.phase)) return;
      const { config } = store.getState().config;
      const chat = store.getState().chat;
      if (tab.windowId === null) return;
      const agent = config.agents.find((a) => a.id === (chat.activeAgentId ?? config.settings.defaultAgentId)) ?? config.agents[0];
      setSaved(null);
      modeRef.current = kept.mode ?? 'update';
      // The base it began with (kept with it); a crawl kept before this was saved too: the site's base as it is.
      const old = kept.base === undefined ? baseOfHost(config.knowledgeBases, kept.startUrl) : (kept.base ?? undefined);
      begin({ ...crawlerSettings(config.settings), ...(kept.overrides ?? {}) }.saveAsItGoes);
      let run: CrawlRun | null = null;
      run = new CrawlRun({
        config,
        agent,
        windowId: tab.windowId,
        tabId: tab.id,
        startUrl: kept.startUrl,
        // Its own time and page limit, running on its own, its model — as chosen when it started.
        overrides: kept.overrides,
        existing: modeRef.current === 'replace' ? undefined : old,
        base: old ?? null,
        mode: modeRef.current,
        onState: (s) => run && watch(run)(s),
      });
      baseRef.current = { kb: old ?? freshBase(kept.startUrl, kept.id), existed: !!old };
      runRef.current = run;
      setState(run.snapshot);
      await run.restore(kept);
    },
    [store, tab.id, tab.windowId, watch],
  );

  /** The user throws the crawl away: its kept copy goes too, and the knowledge base is put back as it was. */
  const discard = useCallback(() => {
    const host = runRef.current?.snapshot.host;
    runRef.current?.stopKeeping();
    if (host) void deleteSavedCrawl(host).catch(() => undefined);
    if (autoRef.current.timer) clearTimeout(autoRef.current.timer);
    const base = baseRef.current;
    if (base && autoRef.current.last) {
      if (base.existed) dispatch(configActions.upsertKnowledgeBase(base.kb));
      else dispatch(configActions.deleteKnowledgeBase(base.kb.id));
    }
    autoRef.current = { on: false, timer: null, last: '', adopted: false };
    runRef.current?.cancel();
    runRef.current = null;
    baseRef.current = null;
    setState(null);
    setSaved(null);
  }, [dispatch]);

  const reset = useCallback(() => {
    if (autoRef.current.timer) clearTimeout(autoRef.current.timer);
    autoRef.current = { on: false, timer: null, last: '', adopted: false };
    runRef.current?.cancel();
    runRef.current = null;
    baseRef.current = null;
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
    /** What is learned goes into the knowledge base as the crawl goes. */
    savesAsItGoes: autoRef.current.on,
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
