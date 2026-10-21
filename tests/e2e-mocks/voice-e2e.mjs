// Voice input (fake microphone) and answer-only models against the mock Kaggle server.
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

const browser = await puppeteer.launch({
  headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--window-size=1400,900'],
});
try {
  const worker = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'));
  const extId = new URL(worker.url()).host;
  const setup = await browser.newPage();
  await setup.setViewport({ width: 1280, height: 900 });
  await setup.goto(`chrome-extension://${extId}/options.html#/voice`);
  await sleep(700);
  const kaggle = { id: 'kaggle', name: 'Kaggle GPU', kind: 'openai', preset: 'kaggle', baseUrl: 'http://localhost:4610/vllm/v1', apiKey: 'test-key', keyHeader: 'X-CareFlow-Key', timeoutMs: 600000, defaultModel: 'qwen3.5:9b', createdAt: 1 };
  await setup.evaluate(async (kaggle) => {
    const cur = (await chrome.storage.local.get('wa.config'))['wa.config'] ?? {};
    const agents = cur.agents ?? [];
    await chrome.storage.local.set({
      'wa.config': {
        ...cur,
        providers: [kaggle],
        settings: { ...(cur.settings ?? {}), defaultProviderId: 'kaggle', voice: { enabled: true, serverUrl: 'http://localhost:4610', key: 'test-key', engine: 'whisper', vocabulary: 'Tom Baker', autoSend: false, mode: 'push', pauseMs: 1000, livePartials: true, voiceCommands: true } },
        agents,
      },
    });
  }, kaggle);
  await setup.reload();
  await sleep(800);

  // Voice page: Check server lists the engines.
  await setup.$$eval('button', (bs) => bs.find((b) => b.textContent?.includes('Check server'))?.click());
  await setup.waitForSelector('.test-banner', { timeout: 10000 });
  const banner = await setup.$eval('.test-banner', (e) => e.textContent);
  check('voice page checks the Kaggle server', /whisper-large-v3-turbo/.test(banner) && /omi-med-stt/.test(banner), banner.slice(0, 120));
  await setup.screenshot({ path: join(OUT, 'options-voice.png'), fullPage: true });

  const panel = await browser.newPage();
  await panel.setViewport({ width: 400, height: 820 });
  panel.on('pageerror', (e) => console.log('[panel exception]', e.message));
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  await panel.waitForSelector('#composer-input');
  const site = await browser.newPage();
  await site.goto('http://localhost:4599/');
  await site.bringToFront();
  await sleep(600);

  // 1) Voice: record with the fake microphone, stop, get the transcript in the composer.
  await panel.$eval('button[aria-label="Start voice input"]', (b) => b.click());
  await panel.waitForSelector('.voice-bar', { timeout: 5000 });
  await panel.bringToFront();
  await sleep(1500);
  await panel.screenshot({ path: join(OUT, 'panel-recording.png') });
  await site.bringToFront();
  await panel.$eval('button[aria-label="Stop recording and transcribe"]', (b) => b.click());
  await panel.waitForFunction(() => document.querySelector('#composer-input')?.value === 'Summarize this page', { timeout: 10000, polling: 200 });
  check('speech transcribed into the composer', true);

  // 2) Send it: Qwen on "Kaggle" answers (through the heartbeat response).
  await panel.$eval('#composer-input', (el) => el.focus());
  await panel.keyboard.press('Enter');
  await panel.waitForFunction(() => document.querySelectorAll('.answer, .notice').length >= 1, { timeout: 20000, polling: 300 });
  const a1 = await panel.$eval('.answer, .notice', (e) => e.textContent);
  check('Kaggle model answers through the key header', /Hello from Qwen on Kaggle/.test(a1), a1.slice(0, 60));

  // 3) MedGemma: known answer-only model → reads the page and answers.
  const setModel = async (model) =>
    setup.evaluate(async (model) => {
      const c = (await chrome.storage.local.get('wa.config'))['wa.config'];
      c.providers[0].defaultModel = model;
      await chrome.storage.local.set({ 'wa.config': c });
    }, model);
  await setModel('hf.co/unsloth/medgemma-4b-it-GGUF:Q4_K_M');
  await sleep(500);
  await site.bringToFront();
  await sleep(300);
  await panel.$eval('#composer-input', (el) => el.focus());
  await panel.keyboard.type('Which patients are listed?');
  await panel.keyboard.press('Enter');
  await panel.waitForFunction(() => document.querySelectorAll('.answer, .notice').length >= 2, { timeout: 20000, polling: 300 });
  const a2 = await panel.$$eval('.answer, .notice', (els) => els.at(-1).textContent);
  check('MedGemma reads the page and answers', /Sara Ahmed, Bilal Raza and Hina Malik/.test(a2), a2.slice(0, 80));

  // 4) Unknown model that rejects tools → automatic fallback after the first error.
  await setModel('mystery-notools');
  await sleep(500);
  await panel.$eval('#composer-input', (el) => el.focus());
  await panel.keyboard.type('Which patients are listed?');
  await panel.keyboard.press('Enter');
  await panel.waitForFunction(() => document.querySelectorAll('.answer, .notice').length >= 3, { timeout: 20000, polling: 300 });
  const a3 = await panel.$$eval('.answer, .notice', (els) => els.at(-1).textContent);
  check('falls back when a model rejects tools', /Sara Ahmed/.test(a3), a3.slice(0, 80));

  await panel.bringToFront();
  await sleep(300);
  await panel.screenshot({ path: join(OUT, 'panel-kaggle.png'), fullPage: true });

  // Models page with the Kaggle connection and its editor.
  await setup.goto(`chrome-extension://${extId}/options.html#/models`);
  await sleep(600);
  await setup.$eval('.provider-main', (b) => b.click());
  await sleep(600);
  await setup.screenshot({ path: join(OUT, 'options-kaggle-editor.png') });
} catch (err) {
  console.error('E2E error:', err);
  results.push(false);
} finally {
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
}
