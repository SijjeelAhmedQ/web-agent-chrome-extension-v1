/**
 * Background service worker. Deliberately small: MV3 workers are stopped when idle, so the
 * agent itself runs in the side panel. The worker only wires up browser-level behaviour.
 */

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
    void chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onStartup.addListener(() => {
  configurePanel();
  void configureLocalModelAccess();
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'open-panel' && tab?.windowId !== undefined) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
  }
});

configurePanel();
