import { sleep } from '@/shared/utils';

/**
 * Lets several agents share one browser window. Chrome only paints the active tab — in a
 * background tab, animations (and so many dropdowns and dialogs) freeze — so each browser
 * action runs with its tab in front, one at a time. Model calls, the slow part, are not
 * held here and overlap freely.
 */
export class ForegroundLock {
  private queue: Promise<unknown> = Promise.resolve();
  private current: number | null = null;

  run<T>(tabId: number | null, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const next = this.queue.then(async () => {
      if (signal?.aborted) throw signal.reason;
      if (tabId !== null) await this.bringToFront(tabId);
      return fn();
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async bringToFront(tabId: number) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return;
    if (!tab.active || this.current !== tabId) {
      await chrome.tabs.update(tabId, { active: true });
      // A few frames for paused animations and layout to catch up.
      await sleep(this.current === tabId ? 60 : 280);
    }
    this.current = tabId;
  }
}
