import { useEffect, useState } from 'react';
import { scriptableReason } from '@/extension/browser/controller';
import { isExtensionContext } from '@/shared/utils';

export interface ActiveTab {
  windowId: number | null;
  id: number | null;
  url: string;
  title: string;
  favIconUrl: string;
  loading: boolean;
  /** Why the agent can't work here, if it can't. */
  restricted: string | null;
}

const EMPTY: ActiveTab = { windowId: null, id: null, url: '', title: '', favIconUrl: '', loading: false, restricted: null };

const toState = (tab: chrome.tabs.Tab | undefined, windowId: number): ActiveTab =>
  tab
    ? {
        windowId,
        id: tab.id ?? null,
        url: tab.url ?? tab.pendingUrl ?? '',
        title: tab.title ?? '',
        favIconUrl: tab.favIconUrl ?? '',
        loading: tab.status === 'loading',
        restricted: scriptableReason(tab.url ?? tab.pendingUrl),
      }
    : { ...EMPTY, windowId };

/** The tab the side panel is next to, kept live as the user browses. */
export function useActiveTab(): ActiveTab {
  const [state, setState] = useState<ActiveTab>(EMPTY);

  useEffect(() => {
    if (!isExtensionContext()) {
      setState({ ...EMPTY, url: location.href, title: document.title, restricted: null });
      return;
    }
    let windowId = -1;
    let disposed = false;

    const refresh = async () => {
      const [tab] = await chrome.tabs.query({ active: true, windowId });
      if (!disposed) setState(toState(tab, windowId));
    };
    const onActivated = (info: chrome.tabs.OnActivatedInfo) => {
      if (info.windowId === windowId) void refresh();
    };
    const onUpdated = (_id: number, change: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => {
      if (tab.windowId === windowId && tab.active && (change.url || change.title || change.status || change.favIconUrl)) setState(toState(tab, windowId));
    };

    // A panel opened on its own (sidepanel.html?window=<id>, for testing and debugging) works next to that window.
    const detached = Number(new URLSearchParams(location.search).get('window'));
    void (detached ? Promise.resolve({ id: detached }) : chrome.windows.getCurrent()).then((w) => {
      windowId = w.id ?? -1;
      void refresh();
    });
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      disposed = true;
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  return state;
}
