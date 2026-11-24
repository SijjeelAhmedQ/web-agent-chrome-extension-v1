import { isExtensionContext } from '@/shared/utils';

/** Opens (or focuses) the configuration page at a section, e.g. `/models`. */
export async function openConfiguration(path = '/agents'): Promise<void> {
  const hash = `#${path}`;
  if (!isExtensionContext()) {
    window.open(`/options.html${hash}`, '_blank');
    return;
  }
  const base = chrome.runtime.getURL('options.html');
  const [existing] = await chrome.tabs.query({ url: `${base}*` });
  if (existing?.id) {
    await chrome.tabs.update(existing.id, { url: `${base}${hash}`, active: true });
    if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: `${base}${hash}` });
}
