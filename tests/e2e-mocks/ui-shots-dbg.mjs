// Screenshots of every surface at phone, tablet, laptop and large sizes, light and dark.
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const EXT = process.argv[2];
const ONLY = process.argv[3]; // optional filter
const OUT = join(import.meta.dirname, 'shots', 'ui');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });

const now = Date.now();
const step = (label, note, status = 'done') => ({ id: Math.random().toString(36).slice(2), label, note, status, tool: 'x', startedAt: now - 9000, durationMs: 800 });
const doneTask = {
  id: 't1', request: 'Find the cheapest 14-inch laptop with 16 GB RAM', agentId: 'agent-assistant', agentName: 'Assistant', url: 'https://shop.example.com', site: 'shop.example.com', title: 'Shop', status: 'done',
  startedAt: now - 60000, endedAt: now - 48000,
  steps: [step('Reading the page', '64 controls · Shop'), step('Typing “14 inch laptop 16GB” into “Search”', 'Submitted'), step('Reading the page content'), step('Double-checking the result on the page')],
  result: 'The cheapest match is the **Aero 14** at **$649** (16 GB RAM, 512 GB SSD).\n\n| Laptop | RAM | Price |\n|---|---|---|\n| Aero 14 | 16 GB | $649 |\n| Nova 14 | 16 GB | $699 |\n| Zen 14 | 16 GB | $749 |',
};
const runningTask = { ...doneTask, id: 't2', request: 'Add hypertension as a diagnosis for Tom Baker', status: 'running', endedAt: undefined, result: undefined, steps: [step('Reading the page', '75 controls · Patients'), step('Clicking “Select”', 'Opened a new page'), step('Clicking “Add diagnosis”', undefined, 'running')] };

async function configure(page, theme) {
  await page.evaluate(
    async (theme, history) => {
      const cur = (await chrome.storage.local.get('wa.config'))['wa.config'] ?? {};
      await chrome.storage.local.set({
        'wa.history': history,
        'wa.config': {
          ...cur,
          providers: [{ id: 'kaggle', name: 'Kaggle GPU', kind: 'openai', preset: 'kaggle', baseUrl: 'http://localhost:4610/vllm/v1', apiKey: 'test-key', keyHeader: 'X-CareFlow-Key', timeoutMs: 600000, defaultModel: 'qwen3.5:9b', createdAt: 1 }],
          settings: { ...(cur.settings ?? {}), theme, defaultProviderId: 'kaggle', voice: { enabled: true, serverUrl: 'http://localhost:4610', key: 'test-key', engine: 'whisper', vocabulary: '', autoSend: false, mode: 'handsfree', pauseMs: 1000, livePartials: true, voiceCommands: true } },
        },
      });
    },
    theme,
    [doneTask, { ...doneTask, id: 't3', request: 'Summarize this article', status: 'failed', error: "Can't reach the AI model." }],
  );
}

try {
  const extId = new URL((await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'))).url()).host;
  const setup = await browser.newPage();
  await setup.goto(`chrome-extension://${extId}/options.html#/agents`);
  await sleep(700);
  await configure(setup, 'light');
  await setup.reload();
  await sleep(700);
  // Add the CareFlow team through the UI so the agents page has variety.
  await setup.$$eval('button', (bs) => bs.find((b) => b.textContent?.includes('New agent'))?.click());
  await sleep(400);
  await setup.$$eval('.ant-dropdown-menu-item', (items) => items.find((i) => i.textContent?.includes('CareFlow team'))?.click());
  await sleep(600);

  for (const theme of ['light', 'dark']) {
    await configure(setup, theme);
    await sleep(300);
    // ---- Side panel
    for (const width of [340, 440, 900]) {
      if (ONLY && !ONLY.includes('panel')) break;
      const panel = await browser.newPage();
      await panel.setViewport({ width, height: 860 });
      await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
      await panel.waitForSelector('#composer-input');
      await sleep(900);
      await panel.screenshot({ path: join(OUT, `panel-${width}-empty-${theme}.png`) });
      await panel.evaluate(
        async (done, running) => {
          await chrome.storage.session.set({ 'wa.chat': { turns: [{ id: 'a', request: done.request, agentId: 'agent-assistant', task: done, thinking: false, approval: null }, { id: 'b', request: running.request, agentId: 'agent-assistant', task: running, thinking: true, approval: null }], memory: [] } });
        },
        doneTask,
        runningTask,
      );
      await panel.reload();
      await panel.waitForSelector('.turn');
      await sleep(700);
      await panel.screenshot({ path: join(OUT, `panel-${width}-chat-${theme}.png`) });
      await panel.evaluate(async () => chrome.storage.session.remove('wa.chat'));
      await panel.close();
    }
    // ---- Configuration
    const sizes = [
      ['phone', 390, 844],
      ['tablet', 900, 1000],
      ['laptop', 1366, 768],
      ['large', 1920, 1080],
    ];
    for (const [name, w, h] of sizes) {
      if (ONLY && !ONLY.includes('options')) break;
      const page = await browser.newPage();
      await page.setViewport({ width: w, height: h, isMobile: name === 'phone', hasTouch: name === 'phone' });
      page.on('pageerror', (e) => console.log('PAGEERROR', name, String(e).slice(0, 300)));
      page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', name, m.text().slice(0, 300)));
      for (const route of name === 'phone' ? ['agents', 'models', 'voice', 'activity'] : name === 'tablet' ? ['agents', 'voice'] : ['agents', 'tools', 'activity']) {
        await page.goto(`chrome-extension://${extId}/options.html#/${route}`);
        await sleep(650);
        await page.screenshot({ path: join(OUT, `options-${name}-${route}-${theme}.png`) });
      }
      if (name === 'phone') {
        await page.goto(`chrome-extension://${extId}/options.html#/agents`);
        await sleep(500);
        await page.click('button[aria-label="Open menu"]');
        await sleep(500);
        await page.screenshot({ path: join(OUT, `options-phone-menu-${theme}.png`) });
        await page.keyboard.press('Escape');
        await sleep(400);
        await page.$eval('.agent-card', (el) => el.click());
        await sleep(700);
        await page.screenshot({ path: join(OUT, `options-phone-editor-${theme}.png`) });
      }
      await page.close();
    }
  }
  console.log('done');
} catch (err) {
  console.error('error', err);
} finally {
  await browser.close();
}
