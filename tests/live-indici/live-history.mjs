// The test window's Web Agent history and setup, read from the side panel (read only; API keys are not printed).
//   node live-history.mjs            → the last few tasks, with model calls and token counts when kept
//   node live-history.mjs <taskId>   → that task's steps
import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIR } from './indici-live.mjs';
const extId = readFileSync(join(DIR, 'ext-id.txt'), 'utf8').trim();
const browser = await puppeteer.connect({ browserWSEndpoint: readFileSync(join(DIR, 'indici-ws.txt'), 'utf8').trim(), defaultViewport: null });
try {
  const target = browser.targets().find((t) => t.url().startsWith(`chrome-extension://${extId}/`) && t.type() === 'page');
  const page = await target.page();
  const all = await page.evaluate(() => chrome.storage.local.get(null));
  const config = all['wa.config'] ?? {};
  const keys = Object.keys(all);
  const safe = {
    storageKeys: keys,
    providers: (config.providers ?? []).map((p) => ({ id: p.id, name: p.name, preset: p.preset, baseUrl: p.baseUrl, model: p.defaultModel, thinking: p.thinking, contextWindow: p.contextWindow })),
    agents: (config.agents ?? []).map((a) => ({ name: a.name, providerId: a.providerId, model: a.model, decision: a.decision, confirmation: a.confirmation, maxSteps: a.maxSteps })),
    settings: Object.fromEntries(Object.entries(config.settings ?? {}).filter(([k]) => !/key|secret|token/i.test(k) && k !== 'voice')),
  };
  writeFileSync(join(DIR, 'history-dump.json'), JSON.stringify(all, (k, v) => (/apiKey|key$/i.test(k) && typeof v === 'string' ? '<hidden>' : v), 1));
  console.log(JSON.stringify(safe, null, 1));
} finally {
  browser.disconnect();
}
