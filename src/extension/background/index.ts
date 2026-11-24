/**
 * Background service worker. Deliberately small: MV3 workers are stopped when idle, so the
 * agent itself runs in the side panel. The worker only wires up browser-level behaviour.
 */

import { BACKUP_AT_KEY, CONFIG_KEY, FRESH_INSTALL_KEY, loadConfig, stripKeys } from '@/shared/storage/configStore';
import { getItem, setItem } from '@/shared/storage/kv';
import { COST_LEDGER_KEY } from '@/shared/storage/costLedger';

const LOCAL_ORIGIN_RULE_ID = 1;

/** Toolbar icon opens the side panel. */
function configurePanel() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
}

/**
 * Local model servers (Ollama, llama.cpp, LM Studio, the CareFlow bridge) reject requests
 * whose Origin is a chrome-extension:// URL. Requests made by this extension to localhost
 * have their Origin header removed so they work without server-side configuration.
 * Only this extension's own requests are affected.
 */
async function configureLocalModelAccess() {
  const rule: chrome.declarativeNetRequest.Rule = {
    id: LOCAL_ORIGIN_RULE_ID,
    priority: 1,
    action: {
      type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
      requestHeaders: [{ header: 'origin', operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE }],
    },
    condition: {
      initiatorDomains: [chrome.runtime.id],
      requestDomains: ['localhost', '127.0.0.1', '0.0.0.0'],
      resourceTypes: [chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST, chrome.declarativeNetRequest.ResourceType.OTHER],
    },
  };
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [LOCAL_ORIGIN_RULE_ID], addRules: [rule] });
  } catch (err) {
    console.warn('[web-agent] could not install the local-model rule', err);
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  configurePanel();
  void configureLocalModelAccess();
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    // Installed again after being removed? The options page offers to restore the backup file.
    void setItem(FRESH_INSTALL_KEY, true).then(() => chrome.runtime.openOptionsPage());
  }
});

chrome.runtime.onStartup.addListener(() => {
  configurePanel();
  void configureLocalModelAccess();
});

/**
 * Automatic backup: a copy of the setup without API keys in Downloads/WebAgent, overwritten a few
 * seconds after each change. Removing the extension deletes everything it stored; this file stays.
 */
const BACKUP_FILE = 'WebAgent/web-agent-backup.json';
let backupTimer: ReturnType<typeof setTimeout> | null = null;

async function backUp() {
  backupTimer = null;
  const config = await loadConfig();
  if (config.settings.autoBackup === false) return;
  // With the day-by-day cost record: only days, models, sites and dollars — it would be lost with the extension.
  const costLedger = await getItem(COST_LEDGER_KEY).catch(() => undefined);
  const json = JSON.stringify({ ...(config.settings.backupKeys ? config : stripKeys(config)), ...(costLedger ? { costLedger } : {}), backedUpAt: new Date().toISOString() }, null, 2);
  const url = `data:application/json;base64,${btoa(unescape(encodeURIComponent(json)))}`;
  const ui = chrome.downloads.setUiOptions;
  try {
    await ui?.({ enabled: false }).catch(() => undefined);
    const id = await chrome.downloads.download({ url, filename: BACKUP_FILE, conflictAction: 'overwrite', saveAs: false });
    // Keep the file, not a new line in the downloads list each time.
    const done = (delta: chrome.downloads.DownloadDelta) => {
      if (delta.id !== id || !delta.state || delta.state.current === 'in_progress') return;
      chrome.downloads.onChanged.removeListener(done);
      void chrome.downloads.erase({ id });
      void ui?.({ enabled: true }).catch(() => undefined);
    };
    chrome.downloads.onChanged.addListener(done);
    await setItem(BACKUP_AT_KEY, Date.now());
  } catch (err) {
    await ui?.({ enabled: true }).catch(() => undefined);
    console.warn('[web-agent] backup failed', err);
  }
}

let backupDue = 0;
/** A backup in `delay` ms — or sooner, if one is due sooner already. */
function backUpIn(delay: number) {
  const due = Date.now() + delay;
  if (backupTimer && backupDue <= due) return;
  if (backupTimer) clearTimeout(backupTimer);
  backupDue = due;
  backupTimer = setTimeout(() => void backUp(), delay);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  // The setup: a few seconds after a change. The cost record changes with every model call: once a minute at most.
  if (changes[CONFIG_KEY]) backUpIn(4_000);
  else if (changes[COST_LEDGER_KEY]) backUpIn(60_000);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'open-panel' && tab?.windowId !== undefined) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
  }
});

configurePanel();
