// An older patient-search page: name links without href, icon-only actions, two rows with the same name.
import puppeteer from 'puppeteer';
import { join } from 'node:path';

const EXT = process.argv[2];
const MODE = process.argv[3] ?? 'mock';
const OUT = join(import.meta.dirname, 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
};

const browser = await puppeteer.launch({ headless: true, protocolTimeout: 900000, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
try {
  const extId = new URL((await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'))).url()).host;
  const setup = await browser.newPage();
  await setup.goto(`chrome-extension://${extId}/options.html`);
  await sleep(600);
  // Real-model runs go to the Kaggle notebook (KAGGLE_URL / KAGGLE_KEY), never a local model.
  const provider =
    MODE === 'kaggle'
      ? { id: 'p', name: 'Kaggle GPU', kind: 'openai', preset: 'kaggle', baseUrl: `${process.env.KAGGLE_URL}/vllm/v1`, apiKey: process.env.KAGGLE_KEY, keyHeader: 'X-CareFlow-Key', timeoutMs: 600000, contextWindow: 16384, defaultModel: process.env.KAGGLE_MODEL ?? 'qwen3.5:9b', createdAt: 1 }
      : { id: 'p', name: 'Mock', kind: 'openai', preset: 'custom', baseUrl: 'http://localhost:4600/v1', apiKey: '', defaultModel: 'mock-1', createdAt: 1 };
  // An agent saved before hover/open_menu existed: the migration must give it the new tools.
  await setup.evaluate(async (provider) => {
    const legacy = ['read_page', 'find_element', 'scroll', 'wait', 'click', 'type', 'clear', 'select_option', 'press_key', 'navigate', 'go_back', 'go_forward', 'list_tabs', 'open_tab', 'switch_tab', 'close_tab'];
    const assistant = { id: 'agent-assistant', name: 'Assistant', description: '', avatar: { icon: 'Sparkles', color: '#10b981' }, instructions: '', providerId: null, model: '', temperature: 0.1, maxSteps: 25, confirmation: 'smart', toolIds: legacy, skillIds: [], createdAt: 1, updatedAt: 1 };
    await chrome.storage.local.set({ 'wa.config': { version: 1, providers: [provider], agents: [assistant], skills: [], customTools: [], settings: { defaultProviderId: 'p', defaultAgentId: 'agent-assistant', developerMode: true, expandActivity: true } } });
  }, provider);
  await setup.reload();
  await sleep(600);

  const panel = await browser.newPage();
  await panel.setViewport({ width: 400, height: 900 });
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  await panel.waitForSelector('#composer-input');
  const site = await browser.newPage();
  await site.setViewport({ width: 1200, height: 700 });

  const tasks = process.env.TASKS
    ? JSON.parse(process.env.TASKS)
    : MODE === 'kaggle'
      ? [['Search Arya STARK in Patient Name and open the Arya STARK born 03-12-2015 by clicking the name.', 'Opened patient: Arya STARK (21-SHC-6844)']]
      : [
          ['Legacy select: Arya STARK', 'Opened patient: Arya STARK (21-SHC-6844)'],
          ['Legacy plain: Arya STARK', 'Opened patient: Arya STARK (21-SHC-6844)'],
          ['Legacy double: Arya STARK', 'Opened patient: Arya STARK (21-SHC-6844)'],
        ];
  let turn = 0;
  for (const [request, expected] of tasks) {
    const query = /double/i.test(request) || MODE === 'kaggle' ? '?plain=1&dbl=1' : /plain/i.test(request) ? '?plain=1' : '';
    await site.goto(`http://localhost:4599/legacy.html${query}`);
    await site.bringToFront();
    await sleep(500);
    turn++;
    await panel.$eval('#composer-input', (el) => el.focus());
    await panel.keyboard.type(request);
    await panel.keyboard.press('Enter');
    const t0 = Date.now();
    for (;;) {
      const done = await panel.evaluate((n) => document.querySelectorAll('.turn .activity.done, .turn .activity.failed, .turn .activity.cancelled, .turn .notice').length >= n, turn);
      if (done) break;
      if (await panel.$('.approval')) await panel.$eval('.approval .ant-btn-default', (b) => b.click());
      if (Date.now() - t0 > 480000) throw new Error('timed out');
      await sleep(800);
    }
    const result = await site.$eval('#result', (e) => e.textContent);
    const steps = await panel.$$eval('.turn:last-child .steps .step-label', (els) => els.map((e) => e.textContent));
    const notes = await panel.$$eval('.turn:last-child .steps .step-note', (els) => els.map((e) => e.textContent));
    const answer = await panel.$eval('.turn:last-child', (e) => e.innerText);
    console.log(`   ${steps.join(' → ')} (${Math.round((Date.now() - t0) / 1000)}s)`);
    console.log(`   notes: ${notes.join(' | ')}`);
    check(`opened the right patient by name`, result === expected, result);
    if (MODE !== 'kaggle' && /double/i.test(request)) {
      check('one click: says it only selected the row', notes.filter((n) => n === 'Selected — nothing opened').length === 2, notes.join(' | '));
      check('third identical click refused', notes.includes('Did nothing twice — not repeating'));
      check('steps say Double-clicking', steps.some((s) => /^Double-clicking/.test(s)), steps.join(' → '));
      check('a hidden modal is not reported as open', /DIALOG no/.test(answer));
    } else if (MODE !== 'kaggle' && /plain/i.test(request)) {
      check('same text twice: not clicked, asks for near', /AMBIG yes/.test(answer) && notes.includes('2 matches — not clicked'), notes.join(' | '));
    } else if (MODE !== 'kaggle') {
      check('wrong id refused before clicking', /GUARD yes/.test(answer) && notes.includes('Wrong element — not clicked'));
      check('icons get names', /book appointment \(icon\)/.test(answer) && /Print label/.test(answer) && /user details \(icon\)/.test(answer) && /edit \(icon\)/.test(answer), answer.split('\n').filter((l) => /\[\d+\]/.test(l)).join(' / '));
      check('name link without href is listed', /link "Arya STARK"/.test(answer));
    }
  }
  await panel.screenshot({ path: join(OUT, `legacy-${MODE}-panel.png`), fullPage: true });
} catch (err) {
  console.error('E2E error:', err);
  results.push(false);
} finally {
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
}
