// End-to-end: loads the built extension in Chrome for Testing, drives the side panel against
// the local test site with the scripted mock model, and screenshots the UI.
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const EXT = process.argv[2];
const MODE = process.argv[3] ?? 'mock'; // mock | ollama
const OUT = join(import.meta.dirname, 'shots');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const shot = async (page, opts) => {
  await page.bringToFront();
  await sleep(250);
  await page.screenshot(opts);
};
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
};

const browser = await puppeteer.launch({
  headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1400,900', '--no-first-run'],
});
try {
  const worker = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'), { timeout: 15000 });
  const extId = new URL(worker.url()).host;
  console.log('extension', extId);

  // Configure through storage, the same document the UI edits.
  const setup = await browser.newPage();
  await setup.goto(`chrome-extension://${extId}/options.html#/models`);
  await sleep(800);
  const provider =
    MODE === 'ollama'
      ? { id: 'ollama', name: 'Ollama', kind: 'ollama', preset: 'ollama', baseUrl: 'http://localhost:11434', apiKey: '', defaultModel: 'qwen3.5:4b', skipThinking: true, contextWindow: 12288, createdAt: 1 }
      : { id: 'mock', name: 'Mock', kind: 'openai', preset: 'custom', baseUrl: 'http://localhost:4600/v1', apiKey: '', defaultModel: 'mock-1', createdAt: 1 };
  await setup.evaluate(async (provider, mode) => {
    const cur = (await chrome.storage.local.get('wa.config'))['wa.config'] ?? {};
    await chrome.storage.local.set({
      'wa.config': { ...cur, providers: [provider], settings: { ...(cur.settings ?? {}), defaultProviderId: provider.id, developerMode: mode === 'mock' } },
    });
  }, provider, MODE);

  const panel = await browser.newPage();
  await panel.setViewport({ width: 400, height: 820 });
  panel.on('console', (m) => m.type() === 'error' && console.log('[panel error]', m.text()));
  panel.on('pageerror', (e) => console.log('[panel exception]', e.message));
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  await panel.waitForSelector('#composer-input');

  const site = await browser.newPage();
  await site.goto('http://localhost:4599/');
  await site.bringToFront();
  await sleep(700);
  const chip = await panel.$eval('.ctx-site', (e) => e.textContent).catch(() => '');
  check('panel tracks the active tab', chip === 'localhost:4599', chip);

  // The panel tab sits in the background (the test site is the active tab), so no rAF-based
  // puppeteer clicks: focus and click through the DOM instead.
  const tap = (sel) => panel.$eval(sel, (el) => el.click());
  const send = async (text) => {
    await site.bringToFront();
    await sleep(400);
    await panel.$eval('#composer-input', (el) => el.focus());
    await panel.keyboard.type(text);
    await panel.keyboard.press('Enter');
  };
  const waitDone = async (count, timeout = 120000) => {
    await panel.waitForFunction((n) => document.querySelectorAll('.turn .activity.done, .turn .activity.failed, .turn .activity.cancelled, .turn .notice').length >= n, { timeout, polling: 300 }, count);
  };

  if (MODE === 'mock') {
    // 1) Form filling, custom dropdown, approval on Save
    await send('Fill the medication form for Ali Khan and save it');
    await panel.waitForSelector('.approval', { timeout: 30000 });
    await shot(panel, { path: join(OUT, 'panel-approval.png') });
    const title = await panel.$eval('.approval-title', (e) => e.textContent);
    check('approval asked before Save', /Save/.test(title), title);
    const fields = await panel.$eval('.approval-fields', (e) => e.innerText.replace(/\n/g, ' ')).catch(() => '');
    check('approval shows what will be saved', /Patient name\s+Ali Khan/.test(fields) && /Frequency\s+Twice daily/.test(fields) && /Route\s+Oral/.test(fields), fields);
    check('radio groups and custom dropdowns read correctly', /As needed \(PRN\)\s+No/.test(fields) && /Unit\s+mg/.test(fields) && !/No\s+Yes/.test(fields), fields);
    await tap('.approval .ant-btn-primary');
    await waitDone(1);
    const status = await site.$eval('#status', (e) => e.textContent);
    check('form filled and saved', status === 'Saved: Ali Khan / Amoxicillin / Twice daily / Oral', status);
    const answer = await panel.$eval('.answer', (e) => e.textContent).catch(() => '');
    check('final answer shown', /Saved the medication/.test(answer));
    const steps = await panel.$$eval('.steps .step-label, .activity-meta', (els) => els.map((e) => e.textContent));
    console.log('   steps:', steps.join(' | '));
    await shot(panel, { path: join(OUT, 'panel-done.png') });

    // 2) Search → navigation → back → table row → link to new tab → tabs
    await send('Search for Bilal and open his chart');
    await waitDone(2);
    const opened = await site.$eval('#opened', (e) => e.textContent).catch(() => '');
    check('clicked the right table row after back navigation', opened === 'Opened chart: Bilal Raza', opened);
    const pages = await browser.pages();
    check('target=_blank link opened in a new tab', pages.some((p) => p.url().includes('results.html?q=help')));
    const answer2 = await panel.$$eval('.answer', (els) => els.at(-1)?.textContent ?? '');
    check('answer used content read after navigation', /Bilal Raza, DOB 1990-02-11/.test(answer2), answer2.slice(0, 80));
    const failed = await panel.$$eval('.turn:last-child .step.failed', (els) => els.map((e) => e.textContent));
    check('no failed steps in search flow', failed.length === 0, failed.join(' | '));
    await shot(panel, { path: join(OUT, 'panel-search.png'), fullPage: true });

    // 2b) A reply cut off by the context limit is not the end of the task.
    await site.$eval('#pname', (e) => { e.value = ''; });
    await send('Hiccup: fill the patient name');
    await waitDone(3);
    const hiccup = await panel.$$eval('.answer, .notice', (els) => els.at(-1)?.textContent ?? '');
    const nameNow = await site.$eval('#pname', (e) => e.value);
    check('cut-off reply did not end the task', /Typed Ali Khan/.test(hiccup) && nameNow === 'Ali Khan', `${hiccup.slice(0, 50)} | field: ${nameNow}`);

    // 2c) Declined once means no: the agent may not ask the same thing again.
    await site.bringToFront();
    await sleep(300);
    await send('Stubborn: save the form');
    await panel.waitForSelector('.approval', { timeout: 20000 });
    await tap('.approval .ant-btn-default');
    let again = 0;
    const tStub = Date.now();
    for (;;) {
      const s = await panel.evaluate(() => ({ approval: !!document.querySelector('.approval'), done: document.querySelectorAll('.turn').length && !!document.querySelector('.turn:last-child .answer, .turn:last-child .notice') }));
      if (s.approval) {
        again++;
        await tap('.approval .ant-btn-default');
      }
      if (s.done || Date.now() - tStub > 20000) break;
      await sleep(200);
    }
    const stubAnswer = await panel.$$eval('.answer, .notice', (els) => els.at(-1)?.textContent ?? '');
    check('a declined step is never asked again — the task stops', again === 0 && /you cancelled “Save”/.test(stubAnswer), `asked again ${again}× | ${stubAnswer.slice(0, 80)}`);

    // 3) Stop
    await site.bringToFront();
    await send('Slow task please');
    await sleep(1200);
    await tap('.stop-btn');
    await waitDone(5, 15000);
    const stopped = await panel.$$eval('.turn', (els) => els.at(-1)?.querySelector('.notice.quiet')?.textContent ?? '');
    check('stop cancels the task', /Stopped/.test(stopped), stopped);

    // 4) History persisted
    const history = await panel.evaluate(async () => (await chrome.storage.local.get('wa.history'))['wa.history']?.map((t) => t.status));
    check('history saved', JSON.stringify(history) === JSON.stringify(['cancelled', 'done', 'done', 'done', 'done']), JSON.stringify(history));

    // 5) Dark mode screenshots of the panel and config pages
    await setup.evaluate(async () => {
      const c = (await chrome.storage.local.get('wa.config'))['wa.config'];
      c.settings.theme = 'dark';
      await chrome.storage.local.set({ 'wa.config': c });
    });
    await sleep(600);
    await shot(panel, { path: join(OUT, 'panel-dark.png') });
    await tap('button[aria-label="New chat"]');
    await sleep(300);
    await shot(panel, { path: join(OUT, 'panel-empty-dark.png') });
    await setup.setViewport({ width: 1280, height: 860 });
    for (const route of ['agents', 'models', 'tools', 'skills', 'permissions', 'activity']) {
      await setup.goto(`chrome-extension://${extId}/options.html#/${route}`);
      await sleep(500);
      await shot(setup, { path: join(OUT, `options-${route}-dark.png`) });
    }
    await setup.evaluate(async () => {
      const c = (await chrome.storage.local.get('wa.config'))['wa.config'];
      c.settings.theme = 'light';
      await chrome.storage.local.set({ 'wa.config': c });
    });
    await setup.goto(`chrome-extension://${extId}/options.html#/agents`);
    await sleep(500);
    await shot(setup, { path: join(OUT, 'options-agents-light.png') });
    await setup.$eval('.agent-card', (el) => el.click());
    await sleep(500);
    await shot(setup, { path: join(OUT, 'options-agent-editor.png') });
    await panel.reload();
    await panel.waitForSelector('#composer-input');
    await sleep(400);
    await tap('button[aria-label="New chat"]').catch(() => {});
    await sleep(300);
    await shot(panel, { path: join(OUT, 'panel-empty-light.png') });
  } else {
    // Real model: Qwen 3.5 4B through Ollama.
    await send('Add medication for patient Ali Khan: Amoxicillin, twice daily, route Oral. Then save.');
    const t0 = Date.now();
    const approval = await panel.waitForSelector('.approval', { timeout: 240000 }).catch(() => null);
    if (approval) {
      console.log('   approval:', await panel.$eval('.approval-title', (e) => e.textContent));
      await tap('.approval .ant-btn-primary');
    }
    await waitDone(1, 240000);
    console.log(`   took ${Math.round((Date.now() - t0) / 1000)}s`);
    const steps = await panel.$$eval('.step', (els) => els.map((e) => e.textContent));
    console.log('   steps:\n    ' + steps.join('\n    '));
    console.log('   answer:', await panel.$eval('.answer, .notice', (e) => e.textContent).catch(() => '(none)'));
    const status = await site.$eval('#status', (e) => e.textContent);
    check('real model filled and saved the form', /Ali Khan/.test(status) && /Twice daily/.test(status), status);
    await shot(panel, { path: join(OUT, 'panel-ollama.png'), fullPage: true });
  }
} catch (err) {
  console.error('E2E error:', err);
  results.push({ name: 'no crash', ok: false });
} finally {
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
