// Hands-free: the microphone (a WAV file) is switched on once. Utterance 1 becomes a command
// that runs by itself; utterance 2 (“confirm”) answers the Save approval. No clicks after the mic.
import puppeteer from 'puppeteer';
import { join } from 'node:path';

const EXT = process.argv[2];
const WAV = join(import.meta.dirname, 'speech.wav').replace(/\\/g, '/');
const OUT = join(import.meta.dirname, 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
};

const browser = await puppeteer.launch({
  headless: true,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-audio-capture=${WAV}%noloop`,
  ],
});
try {
  const extId = new URL((await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'))).url()).host;
  const setup = await browser.newPage();
  await setup.goto(`chrome-extension://${extId}/options.html`);
  await sleep(600);
  await setup.evaluate(async () => {
    const cur = (await chrome.storage.local.get('wa.config'))['wa.config'] ?? {};
    await chrome.storage.local.set({
      'wa.config': {
        ...cur,
        providers: [{ id: 'mock', name: 'Mock', kind: 'openai', preset: 'custom', baseUrl: 'http://localhost:4600/v1', apiKey: '', defaultModel: 'mock-1', createdAt: 1 }],
        settings: {
          ...(cur.settings ?? {}),
          defaultProviderId: 'mock',
          voice: { enabled: true, serverUrl: 'http://localhost:4610', key: 'test-key', engine: 'whisper', vocabulary: '', autoSend: false, mode: 'handsfree', pauseMs: 900, livePartials: true, voiceCommands: true },
        },
      },
    });
  });

  const panel = await browser.newPage();
  await panel.setViewport({ width: 400, height: 860 });
  panel.on('pageerror', (e) => console.log('[panel exception]', e.message));
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  await panel.waitForSelector('#composer-input');
  await panel.evaluate(() => {
    window.__seen = { partial: false, approvals: 0 };
    new MutationObserver(() => {
      if (document.querySelector('.live-partial')) window.__seen.partial = true;
      window.__seen.approvals = Math.max(window.__seen.approvals, document.querySelectorAll('.approval').length);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  const site = await browser.newPage();
  await site.goto('http://localhost:4599/');
  await site.bringToFront();
  await sleep(500);

  // The only click: switch the microphone on.
  await panel.$eval('button[aria-label="Start hands-free voice"]', (b) => b.click());
  await panel.waitForSelector('.live-bar', { timeout: 5000 });
  check('hands-free listening started', true);

  let shot = false;
  const t0 = Date.now();
  let status = '';
  while (Date.now() - t0 < 45000) {
    status = await site.$eval('#status', (e) => e.textContent).catch(() => '');
    if (status) break;
    if (!shot && (await panel.$('.approval'))) {
      await panel.bringToFront();
      await sleep(150);
      await panel.screenshot({ path: join(OUT, 'panel-handsfree.png'), fullPage: true });
      await site.bringToFront();
      shot = true;
    }
    await sleep(400);
  }
  const seen = await panel.evaluate(() => window.__seen);
  const request = await panel.$eval('.user-msg .bubble', (e) => e.textContent).catch(() => '');
  check('the spoken command ran by itself after the pause', request === 'Fill the medication form for Ali Khan and save it', request);
  check('live words appeared while speaking', seen.partial);
  check('the approval appeared and “confirm” answered it — no click', seen.approvals >= 1 && status === 'Saved: Ali Khan / Amoxicillin / Twice daily / Oral', status || '(not saved)');
  await sleep(1500);
  const still = await panel.$('.live-bar');
  check('still listening for the next command', !!still);
} catch (err) {
  console.error('E2E error:', err);
  results.push(false);
} finally {
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
}
