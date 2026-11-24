// Runtime bar: (A) first run finds the real local Ollama and connects in one click;
// (B) Kaggle connection + voice show model, engine and “Kaggle” with live status.
import puppeteer from 'puppeteer';
import { join } from 'node:path';

const EXT = process.argv[2];
const OUT = join(import.meta.dirname, 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
};
const launch = () => puppeteer.launch({ headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
const extIdOf = async (browser) => new URL((await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'))).url()).host;
const chips = (panel) => panel.$$eval('.rt-chip', (els) => els.map((e) => `${e.textContent} [${e.className.replace('rt-chip ', '')}]`));

// ---------- A: first run with Ollama on this computer
let browser = await launch();
try {
  const extId = await extIdOf(browser);
  const panel = await browser.newPage();
  await panel.setViewport({ width: 380, height: 820 });
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  await panel.waitForSelector('.setup-card', { timeout: 10000 });
  await panel.waitForFunction(() => /Ollama is running on this computer/.test(document.querySelector('.setup-card')?.textContent ?? ''), { timeout: 15000, polling: 300 });
  check('first run finds Ollama on this computer', true);
  await panel.screenshot({ path: join(OUT, 'panel-ollama-found.png') });
  await panel.$$eval('.setup-card button', (bs) => bs.find((b) => b.textContent.includes('Use Ollama')).click());
  await panel.waitForSelector('.runtime-bar', { timeout: 10000 });
  await panel.waitForFunction(() => document.querySelector('.rt-chip.ok, .rt-chip.warning, .rt-chip.error'), { timeout: 20000, polling: 300 });
  const c = await chips(panel);
  check('bar shows the Ollama model on this computer', /Qwen 3\.5 4B·This computer/.test(c[0]) && /\[ok\]/.test(c[0]), c.join(' | '));
  await panel.screenshot({ path: join(OUT, 'panel-runtime-ollama.png') });
} catch (err) {
  console.error('A error:', err);
  results.push(false);
} finally {
  await browser.close();
}

// ---------- B: Kaggle notebook (mock) for actions and voice
browser = await launch();
try {
  const extId = await extIdOf(browser);
  const setup = await browser.newPage();
  await setup.goto(`chrome-extension://${extId}/options.html`);
  await sleep(600);
  await setup.evaluate(async () => {
    const cur = (await chrome.storage.local.get('wa.config'))['wa.config'] ?? {};
    await chrome.storage.local.set({
      'wa.config': {
        ...cur,
        providers: [{ id: 'kaggle', name: 'Kaggle GPU', kind: 'openai', preset: 'kaggle', baseUrl: 'http://localhost:4610/vllm/v1', apiKey: 'test-key', keyHeader: 'X-CareFlow-Key', timeoutMs: 600000, defaultModel: 'qwen3.5:9b', createdAt: 1 }],
        settings: { ...(cur.settings ?? {}), defaultProviderId: 'kaggle', voice: { enabled: true, serverUrl: 'http://localhost:4610', key: 'test-key', engine: 'whisper', vocabulary: '', autoSend: false } },
      },
    });
  });
  const panel = await browser.newPage();
  await panel.setViewport({ width: 380, height: 820 });
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  await panel.waitForSelector('.runtime-bar');
  await panel.waitForFunction(() => document.querySelectorAll('.rt-chip.ok').length === 2, { timeout: 15000, polling: 300 });
  const c = await chips(panel);
  check('bar shows Qwen 3.5 9B on Kaggle', /Qwen 3\.5 9B·Kaggle/.test(c[0]), c[0]);
  check('bar shows Whisper turbo v3 on Kaggle', /Whisper turbo v3·Kaggle/.test(c[1] ?? ''), c[1]);
  await panel.click('.runtime-bar');
  await panel.waitForSelector('.rt-pop', { timeout: 5000 });
  await sleep(300);
  const pop = await panel.$eval('.rt-pop', (e) => e.innerText);
  check('details name the hosted Kaggle link and GPU', /Kaggle GPU · hosted/.test(pop) && /localhost:4610/.test(pop) && /Tesla T4/.test(pop), pop.replace(/\n/g, ' | ').slice(0, 220));
  await panel.screenshot({ path: join(OUT, 'panel-runtime-kaggle.png') });

  // Switch the agent to Bonsai, which the mock notebook doesn't have → warning.
  await setup.evaluate(async () => {
    const c = (await chrome.storage.local.get('wa.config'))['wa.config'];
    c.providers[0].defaultModel = 'ternary-bonsai-2-27b';
    await chrome.storage.local.set({ 'wa.config': c });
  });
  await panel.waitForFunction(() => /Ternary Bonsai/.test(document.querySelector('.rt-chip')?.textContent ?? '') && document.querySelector('.rt-chip')?.classList.contains('warning'), { timeout: 15000, polling: 300 });
  check('warns when the chosen model is not loaded on the notebook', true);
} catch (err) {
  console.error('B error:', err);
  results.push(false);
} finally {
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
}
