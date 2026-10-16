import { CHANNEL, type ContentError, type ContentRequest, type ContentResponse, type Envelope, type ResponseMap, type ClickEffect } from '../messaging/protocol';
import { sleep } from '@/shared/utils';

/**
 * The agent's handle on the browser. Runs in the side panel (an extension page with full
 * chrome.* access). Owns which tab the agent is working in, injects the content script on
 * demand and turns every browser failure into something the agent can reason about.
 */

/** A recoverable failure the model should see (and can work around). */
export class PageError extends Error {
  constructor(
    public readonly code: ContentError['code'] | 'restricted' | 'gone' | 'navigating',
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'PageError';
  }
}

const RESTRICTED_HOSTS = ['chromewebstore.google.com', 'chrome.google.com'];

export function scriptableReason(url: string | undefined): string | null {
  if (!url) return 'This tab has no page loaded yet.';
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'This tab has no page loaded yet.';
  }
  if (u.protocol === 'chrome:' || u.protocol === 'edge:' || u.protocol === 'about:' || u.protocol === 'chrome-extension:' || u.protocol === 'devtools:' || u.protocol === 'view-source:') {
    return "This is a built-in browser page, which extensions aren't allowed to read or control.";
  }
  if (RESTRICTED_HOSTS.includes(u.host) && (u.host !== 'chrome.google.com' || u.pathname.startsWith('/webstore'))) {
    return "Chrome doesn't allow extensions to work on the Web Store.";
  }
  if (!/^(https?|file):$/.test(u.protocol)) return "This kind of page can't be controlled.";
  if (/\.pdf($|\?)/i.test(u.pathname)) return 'This is a PDF in the built-in viewer, which extensions can’t control.';
  return null;
}

export interface TabSummary {
  id: number;
  title: string;
  url: string;
  active: boolean;
}

export class BrowserController {
  private tabId: number | null;

  constructor(
    private readonly windowId: number,
    tabId: number | null,
  ) {
    this.tabId = tabId;
  }

  get currentTabId(): number | null {
    return this.tabId;
  }

  async currentTab(): Promise<chrome.tabs.Tab> {
    if (this.tabId !== null) {
      try {
        return await chrome.tabs.get(this.tabId);
      } catch {
        this.tabId = null;
      }
    }
    const [active] = await chrome.tabs.query({ active: true, windowId: this.windowId });
    if (!active?.id) throw new PageError('gone', 'There is no open tab to work in.');
    this.tabId = active.id;
    return active;
  }

  private async ping(tabId: number): Promise<boolean> {
    try {
      const res = (await Promise.race([
        chrome.tabs.sendMessage(tabId, { channel: CHANNEL, request: { kind: 'ping' } } satisfies Envelope, { frameId: 0 }),
        sleep(800).then(() => null),
      ])) as ContentResponse | null;
      return !!res?.ok;
    } catch {
      return false;
    }
  }

  private async ensureInjected(tab: chrome.tabs.Tab): Promise<void> {
    const reason = scriptableReason(tab.url);
    if (reason) throw new PageError('restricted', reason);
    if (await this.ping(tab.id!)) return;
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id!, frameIds: [0] }, files: ['content.js'] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/file:\/\//.test(tab.url ?? '') || /Cannot access contents of url "file/i.test(msg)) {
        throw new PageError('restricted', 'To work on local files, turn on “Allow access to file URLs” for this extension in chrome://extensions.', msg);
      }
      throw new PageError('restricted', "I can't access this page. It may be protected by the browser or still loading.", msg);
    }
  }

  /** The text of the frames in the agent's tab whose address is on one of these hosts (other sites' frames). */
  async frameTexts(hosts: string[], maxChars = 3500): Promise<{ host: string; text: string }[]> {
    const tab = await this.currentTab();
    const results = await chrome.scripting
      .executeScript({ target: { tabId: tab.id!, allFrames: true }, func: () => ({ url: location.href, text: document.body?.innerText ?? '' }) })
      .catch(() => []);
    const out: { host: string; text: string }[] = [];
    for (const r of results) {
      if (r.frameId === 0 || !r.result) continue;
      const { url, text } = r.result as { url: string; text: string };
      let host = '';
      try {
        host = new URL(url).host;
      } catch {
        continue;
      }
      if (hosts.includes(host) && text.trim()) out.push({ host, text: text.trim().replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').slice(0, maxChars) });
    }
    return out;
  }

  /** Sends a request to the content script in the agent's current tab. */
  async send<K extends ContentRequest['kind']>(request: Extract<ContentRequest, { kind: K }>): Promise<ResponseMap[K]> {
    const tab = await this.currentTab();
    if (tab.status === 'loading') await this.waitForLoad(tab.id!, 10_000);
    await this.ensureInjected(tab);
    let res: ContentResponse<ResponseMap[K]> | undefined;
    try {
      res = await chrome.tabs.sendMessage(tab.id!, { channel: CHANNEL, request } satisfies Envelope, { frameId: 0 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/message port closed|back\/forward cache|Receiving end does not exist/i.test(msg)) {
        throw new PageError('navigating', 'The page changed while I was working on it.', msg);
      }
      throw new PageError('gone', 'I lost connection to the page.', msg);
    }
    if (!res) throw new PageError('navigating', 'The page changed while I was working on it.');
    if (!res.ok) throw new PageError(res.error.code, res.error.message, res.error.detail);
    return res.data;
  }

  async waitForLoad(tabId: number, timeoutMs: number, signal?: AbortSignal): Promise<void> {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || tab.status === 'complete') return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, timeoutMs);
      function listener(id: number, info: chrome.tabs.OnUpdatedInfo) {
        if (id === tabId && info.status === 'complete') done();
      }
      function done() {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        signal?.removeEventListener('abort', done);
        resolve();
      }
      chrome.tabs.onUpdated.addListener(listener);
      signal?.addEventListener('abort', done, { once: true });
    });
  }

  /**
   * After a click or key press: waits for a navigation if one starts, otherwise for the DOM
   * to go quiet. Reports whether the page changed.
   */
  async settleAfterAction(urlBefore: string, signal?: AbortSignal): Promise<{ navigated: boolean; url: string; title: string; alerts: string[]; effect?: ClickEffect }> {
    const tab = await this.currentTab();
    const tabId = tab.id!;
    const navStarted = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => finish(false), 900);
      function listener(id: number, info: chrome.tabs.OnUpdatedInfo) {
        if (id === tabId && (info.status === 'loading' || info.url)) finish(true);
      }
      function finish(v: boolean) {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(v);
      }
      chrome.tabs.onUpdated.addListener(listener);
    });
    const settled = this.send({ kind: 'settle', quietMs: 350, timeoutMs: 2500 }).catch(() => null);
    const navigated = await navStarted;
    let alerts: string[] = [];
    let effect: ClickEffect | undefined;
    if (navigated) {
      await this.waitForLoad(tabId, 15_000, signal);
      await sleep(300);
    } else {
      const result = await settled;
      alerts = result?.alerts ?? [];
      effect = result?.effect;
    }
    const after = await chrome.tabs.get(tabId);
    return { navigated: navigated || after.url !== urlBefore, url: after.url ?? '', title: after.title ?? '', alerts, effect };
  }

  async navigate(url: string, signal?: AbortSignal): Promise<chrome.tabs.Tab> {
    const tab = await this.currentTab();
    await chrome.tabs.update(tab.id!, { url });
    await sleep(150);
    await this.waitForLoad(tab.id!, 20_000, signal);
    return chrome.tabs.get(tab.id!);
  }

  async history(direction: 'back' | 'forward', signal?: AbortSignal): Promise<chrome.tabs.Tab> {
    const tab = await this.currentTab();
    try {
      if (direction === 'back') await chrome.tabs.goBack(tab.id!);
      else await chrome.tabs.goForward(tab.id!);
    } catch {
      throw new PageError('unsupported', direction === 'back' ? 'There is no previous page in this tab.' : 'There is no next page in this tab.');
    }
    await sleep(250);
    await this.waitForLoad(tab.id!, 15_000, signal);
    return chrome.tabs.get(tab.id!);
  }

  async openTab(url: string, signal?: AbortSignal): Promise<chrome.tabs.Tab> {
    await this.setPresence(false);
    const tab = await chrome.tabs.create({ url, windowId: this.windowId, active: true });
    this.tabId = tab.id!;
    await sleep(150);
    await this.waitForLoad(tab.id!, 20_000, signal);
    return chrome.tabs.get(tab.id!);
  }

  async listTabs(): Promise<TabSummary[]> {
    const tabs = await chrome.tabs.query({ windowId: this.windowId });
    return tabs
      .filter((t) => t.id !== undefined)
      .map((t) => ({ id: t.id!, title: t.title ?? '', url: t.url ?? '', active: t.id === this.tabId }));
  }

  async switchTab(tabId: number): Promise<chrome.tabs.Tab> {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || tab.windowId !== this.windowId) throw new PageError('gone', `There's no tab ${tabId} in this window.`);
    await this.setPresence(false);
    this.tabId = tabId;
    await chrome.tabs.update(tabId, { active: true });
    return tab;
  }

  async closeTab(tabId?: number): Promise<{ closed: number; now: chrome.tabs.Tab | null }> {
    const id = tabId ?? (await this.currentTab()).id!;
    await chrome.tabs.remove(id);
    if (id === this.tabId) this.tabId = null;
    await sleep(100);
    const now = await this.currentTab().catch(() => null);
    return { closed: id, now };
  }

  /**
   * A real mouse click (trusted input, with a user gesture) through Chrome's debugger, at
   * viewport coordinates. For pages that ignore script clicks or open a window on click —
   * pop-ups from script clicks are blocked. Returns a tab the click opened, if any.
   */
  async realClick(x: number, y: number, double: boolean): Promise<chrome.tabs.Tab | null> {
    const tab = await this.currentTab();
    const target = { tabId: tab.id! };
    let opened: chrome.tabs.Tab | null = null;
    const onCreated = (t: chrome.tabs.Tab) => {
      if (t.openerTabId === tab.id) opened = t;
    };
    chrome.tabs.onCreated.addListener(onCreated);
    try {
      try {
        await chrome.debugger.attach(target, '1.3');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new PageError('unsupported', 'A real mouse click isn’t possible on this tab right now (are DevTools open on it?).', msg);
      }
      try {
        const mouse = (params: Record<string, unknown>) => chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { x, y, ...params });
        await mouse({ type: 'mouseMoved' });
        for (let count = 1; count <= (double ? 2 : 1); count++) {
          await mouse({ type: 'mousePressed', button: 'left', buttons: 1, clickCount: count });
          await mouse({ type: 'mouseReleased', button: 'left', buttons: 0, clickCount: count });
        }
      } finally {
        await chrome.debugger.detach(target).catch(() => undefined);
      }
      await sleep(700);
    } finally {
      chrome.tabs.onCreated.removeListener(onCreated);
    }
    return opened;
  }

  /** Notices tabs and pop-up windows the agent's tab opens (window.open, target=_blank) while it is on. */
  async watchNewTabs(): Promise<{ opened: () => chrome.tabs.Tab | null; stop: () => void }> {
    const opener = (await this.currentTab()).id;
    let opened: chrome.tabs.Tab | null = null;
    const listener = (t: chrome.tabs.Tab) => {
      if (t.openerTabId === opener && !opened) opened = t;
    };
    chrome.tabs.onCreated.addListener(listener);
    return { opened: () => opened, stop: () => chrome.tabs.onCreated.removeListener(listener) };
  }

  /** Makes a tab the page opened (a new tab or a pop-up window) the agent's tab, where it is. */
  async adoptTab(tab: chrome.tabs.Tab, signal?: AbortSignal): Promise<chrome.tabs.Tab> {
    const id = tab.id!;
    await this.setPresence(false);
    this.tabId = id;
    if (tab.windowId !== this.windowId) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
    else await chrome.tabs.update(id, { active: true }).catch(() => undefined);
    await this.waitForLoad(id, 20_000, signal);
    return chrome.tabs.get(id);
  }

  /** The thin glow around the page while the agent works there. Best-effort. */
  async setPresence(active: boolean): Promise<void> {
    if (this.tabId === null) return;
    try {
      const tab = await chrome.tabs.get(this.tabId);
      if (scriptableReason(tab.url)) return;
      if (!active && !(await this.ping(tab.id!))) return;
      await this.send({ kind: 'presence', active });
    } catch {
      /* the page may be gone — nothing to clean up */
    }
  }
}
