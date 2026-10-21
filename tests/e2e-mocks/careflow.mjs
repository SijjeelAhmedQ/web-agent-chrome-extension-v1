// Real-model run against the CareFlow PMS dev server (React + Ant Design), auto-approving.
import puppeteer from 'puppeteer';
import { join } from 'node:path';

const EXT = process.argv[2];
const TASK = process.argv[3];
const URL_START = process.argv[4] ?? 'http://localhost:5173/';
const SHOT = join(import.meta.dirname, 'shots', process.argv[5] ?? 'careflow.png');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1400,900'] });
try {
  const worker = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'));
  const extId = new URL(worker.url()).host;
  const setup = await browser.newPage();
  await setup.goto(`chrome-extension://${extId}/options.html`);
  await sleep(600);
  await setup.evaluate(async () => {
    const cur = (await chrome.storage.local.get('wa.config'))['wa.config'] ?? {};
    await chrome.storage.local.set({
      'wa.config': {
        ...cur,
        providers: [{ id: 'ollama', name: 'Ollama', kind: 'ollama', preset: 'ollama', baseUrl: 'http://localhost:11434', apiKey: '', defaultModel: 'qwen3.5:4b', skipThinking: true, contextWindow: 12288, createdAt: 1 }],
        settings: { ...(cur.settings ?? {}), defaultProviderId: 'ollama', developerMode: true, expandActivity: true },
      },
    });
  });
  const panel = await browser.newPage();
  await panel.setViewport({ width: 400, height: 900 });
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  await panel.waitForSelector('#composer-input');
  const site = await browser.newPage();
  await site.setViewport({ width: 1280, height: 860 });
  // Keep CareFlow's own in-app assistant off the shared local model during the test.
  await site.goto(URL_START, { waitUntil: 'networkidle2' });
  await site.evaluate(() => localStorage.setItem('careflow.ai.config', JSON.stringify({ llm: { apiUrl: 'http://127.0.0.1:9' } })));
  await site.reload({ waitUntil: 'networkidle2' });
  await site.bringToFront();
  await sleep(800);

  await panel.$eval('#composer-input', (el) => el.focus());
  await panel.keyboard.type(TASK);
  await panel.keyboard.press('Enter');
  const t0 = Date.now();
  let approvals = 0;
  for (;;) {
    const state = await panel.evaluate(() => ({
      done: !!document.querySelector('.turn .activity.done, .turn .activity.failed, .turn .activity.cancelled, .turn .notice'),
      approval: document.querySelector('.approval-title')?.textContent ?? null,
      fields: document.querySelector('.approval-fields')?.innerText?.replace(/\n/g, ' | ') ?? null,
    }));
    if (state.done) break;
    if (state.approval) {
      approvals++;
      console.log('   approving:', state.approval, '\n     fields:', state.fields);
      await panel.$eval('.approval .ant-btn-primary', (el) => el.click());
    }
    if (Date.now() - t0 > Number(process.env.BUDGET_MS ?? 420000)) {
      console.log('   timed out — stopping');
      await panel.$eval('.stop-btn', (el) => el.click()).catch(() => {});
      await sleep(1500);
      break;
    }
    await sleep(1000);
  }
  console.log(`took ${Math.round((Date.now() - t0) / 1000)}s, approvals ${approvals}`);
  const steps = await panel.$$eval('.step', (els) => els.map((e) => e.querySelector('.step-label')?.textContent + (e.querySelector('.step-note') ? ` — ${e.querySelector('.step-note').textContent}` : '') + ` [${e.className.replace('step ', '')}]`));
  console.log('steps:\n  ' + steps.join('\n  '));
  console.log('answer:', await panel.$eval('.answer, .notice', (e) => e.textContent).catch(() => '(none)'));
  console.log('site url:', site.url());
  console.log('page header:', await site.$eval('#ctx', (e) => e.textContent).catch(() => '(n/a)'));
  console.log('selected patient id:', await site.evaluate(() => localStorage.getItem('careflow.selectedPatientId')));
  console.log('header:', await site.evaluate(() => document.querySelector('header')?.innerText?.replace(/\s+/g, ' ').slice(0, 160)));
  console.log('site status:', await site.$eval('#status', (e) => e.textContent).catch(() => '(n/a)'));
  await site.screenshot({ path: SHOT.replace('.png', '-site.png') });
  await panel.bringToFront();
  await sleep(300);
  await panel.screenshot({ path: SHOT, fullPage: true });
} catch (err) {
  console.error('error', err);
} finally {
  await browser.close();
}
