import puppeteer from 'puppeteer';
import { join } from 'node:path';
const EXT = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
try {
  const worker = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'));
  const extId = new URL(worker.url()).host;
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1000 });
  await page.goto(`chrome-extension://${extId}/options.html#/models`);
  await sleep(800);
  // Start from the preset grid like a new user: pick “Kaggle GPU”.
  await page.$$eval('.preset-card', (cards) => cards.find((c) => c.textContent.includes('Kaggle GPU')).click());
  await sleep(500);
  await page.type('#prov-url', 'https://example-tunnel.trycloudflare.com');
  await page.click('#prov-key');
  await page.type('#prov-key', 'my-notebook-key');
  await sleep(300);
  const url = await page.$eval('#prov-url', (e) => e.value);
  console.log('normalized address:', url);
  await page.$$eval('.model-option', (opts) => opts[1].click());
  await sleep(400);
  await page.screenshot({ path: join(import.meta.dirname, 'shots', 'options-kaggle-editor.png') });
  await page.$$eval('.ant-modal button', (bs) => bs.find((b) => b.textContent.includes('Add connection')).click());
  await sleep(600);
  const cfg = await page.evaluate(async () => (await chrome.storage.local.get('wa.config'))['wa.config']);
  console.log('saved provider:', JSON.stringify({ baseUrl: cfg.providers[0].baseUrl, model: cfg.providers[0].defaultModel, keyHeader: cfg.providers[0].keyHeader, timeoutMs: cfg.providers[0].timeoutMs }));
  console.log('voice auto-filled:', JSON.stringify({ serverUrl: cfg.settings.voice.serverUrl, enabled: cfg.settings.voice.enabled, hasKey: !!cfg.settings.voice.key }));
  await page.goto(`chrome-extension://${extId}/options.html#/agents`);
  await sleep(500);
  await page.$eval('.agent-card', (el) => el.click());
  await sleep(600);
  await page.$$eval('.ant-tabs-tab', (tabs) => tabs.find((t) => t.textContent.includes('Model')).click());
  await sleep(400);
  await page.click('.ant-select-auto-complete input');
  await page.keyboard.type('medgemma');
  await sleep(600);
  await page.screenshot({ path: join(import.meta.dirname, 'shots', 'options-agent-medgemma.png') });
} finally {
  await browser.close();
}
