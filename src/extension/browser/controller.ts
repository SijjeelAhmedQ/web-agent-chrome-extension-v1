import { LEAVE_GUARD } from './leaveGuard';
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
    let tab = await this.currentTab();
    // A tab just opened on a slow site is still about:blank, its real address pending — not a page
    // that can't be worked on: wait for it (a consult can take half a minute to open).
    const opening = (t: chrome.tabs.Tab) => t.status === 'loading' && /^https?:/.test(t.pendingUrl ?? '') && !/^https?:/.test(t.url ?? '');
    if (opening(tab)) {
      await this.waitForLoad(tab.id!, 45_000);
      tab = (await chrome.tabs.get(tab.id!).catch(() => null)) ?? tab;
      if (opening(tab)) throw new PageError('navigating', 'The page is still opening (the site is slow). Wait a few seconds and read it again.');
    }
    // A frame inside the page loading (a PDF in a pop-up) shows the whole tab as loading: quick
    // questions about what's on top of the page don't wait for it.
    const quick = request.kind === 'dialogs' || request.kind === 'popupControl' || request.kind === 'fetchPdf';
    if (tab.status === 'loading') await this.waitForLoad(tab.id!, quick ? 1_500 : 10_000);
    await this.ensureInjected(tab);
    if (request.kind === 'click' || request.kind === 'key') await this.armLeaveGuard(tab.id!);
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
    // A save that is still answering (“Saving…”) is waited for, up to 5 s.
    const settled = this.send({ kind: 'settle', quietMs: 350, timeoutMs: 5000 }).catch(() => null);
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

  /**
   * Leaving a page the agent typed into: what happens when the page has unsaved changes. A page like that asks
   * “Leave site? Changes you made may not be saved” — a browser dialog that can't be seen or answered from the
   * page, and holds the tab until a person clicks it. `ask` (the web agent): such a leave is held back and the
   * agent asks the user in the chat first. `always` (the crawler, whose test values are its own): left freely.
   */
  leaveMode: 'ask' | 'always' = 'ask';

  /** Puts the page's leave guard in place (once per page) — before anything that may leave it. */
  private async armLeaveGuard(tabId: number): Promise<void> {
    await this.inPage(tabId, LEAVE_GUARD, [this.leaveMode === 'always' ? 'allow' : 'arm']);
  }

  /** Would leaving the page now lose changes (its “Leave site?” question)? */
  async unsavedChanges(): Promise<boolean> {
    const tab = await this.currentTab().catch(() => null);
    return tab?.id ? (await this.inPage(tab.id, LEAVE_GUARD, ['probe'])) === true : false;
  }

  /** The address a click tried to leave for, held back because the page has unsaved changes (once). */
  async heldLeave(): Promise<string | null> {
    const tab = await this.currentTab().catch(() => null);
    const held = tab?.id ? await this.inPage(tab.id, LEAVE_GUARD, ['take']) : null;
    return typeof held === 'string' ? held : null;
  }

  /** The user agreed: the page may be left, losing its unsaved changes. */
  async allowLeave(): Promise<void> {
    const tab = await this.currentTab().catch(() => null);
    if (tab?.id) await this.inPage(tab.id, LEAVE_GUARD, ['allow']);
  }

  private async inPage(tabId: number, func: (op: string) => unknown, args: [string]): Promise<unknown> {
    const [r] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'MAIN', func, args }).catch(() => []);
    return r?.result;
  }

  async navigate(url: string, signal?: AbortSignal): Promise<chrome.tabs.Tab> {
    const tab = await this.currentTab();
    await this.armLeaveGuard(tab.id!);
    await chrome.tabs.update(tab.id!, { url });
    await sleep(150);
    if (this.leaveMode === 'always') await this.answerLeaveDialog(tab.id!, tab.url ?? '');
    await this.waitForLoad(tab.id!, 20_000, signal);
    return chrome.tabs.get(tab.id!);
  }

  /**
   * The page asked “Leave site?” all the same (the tab stays where it was, not loading): the browser's dialog is
   * answered “Leave” through the debugger — the crawler's test values are its own, nothing real is lost.
   */
  private async answerLeaveDialog(tabId: number, from: string): Promise<void> {
    for (let i = 0; i < 6; i++) {
      const t = await chrome.tabs.get(tabId).catch(() => null);
      if (!t || t.status === 'loading' || (t.url && t.url !== from) || (t.pendingUrl && t.pendingUrl !== from)) return;
      await sleep(200);
    }
    const target = { tabId };
    try {
      await chrome.debugger.attach(target, '1.3');
    } catch {
      return; // DevTools already attached, or not allowed here
    }
    try {
      await chrome.debugger.sendCommand(target, 'Page.enable').catch(() => undefined);
      await chrome.debugger.sendCommand(target, 'Page.handleJavaScriptDialog', { accept: true }).catch(() => undefined);
    } finally {
      await chrome.debugger.detach(target).catch(() => undefined);
    }
  }

  async history(direction: 'back' | 'forward', signal?: AbortSignal): Promise<chrome.tabs.Tab> {
    const tab = await this.currentTab();
    await this.armLeaveGuard(tab.id!);
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
    await this.armLeaveGuard(tab.id!);
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

  /**
   * Real keyboard input of `text` at the caret, through Chrome's debugger — for rich editors (CKEditor)
   * that keep their own model and ignore text a script puts in.
   */
  async realType(text: string): Promise<void> {
    const target = { tabId: (await this.currentTab()).id! };
    try {
      await chrome.debugger.attach(target, '1.3');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new PageError('unsupported', 'Real typing isn’t possible on this tab right now (are DevTools open on it?).', msg);
    }
    try {
      await chrome.debugger.sendCommand(target, 'Input.insertText', { text });
    } finally {
      await chrome.debugger.detach(target).catch(() => undefined);
    }
    await sleep(300);
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
