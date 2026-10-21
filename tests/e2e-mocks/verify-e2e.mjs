// The Luke King bug: a model claims a selection it never made. With “Double-check before
// answering” the runtime re-reads the page and the claim is corrected; without it, it isn't.
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

async function run(verify) {
  const browser = await puppeteer.launch({ headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  try {
    const extId = new URL((await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'))).url()).host;
    const setup = await browser.newPage();
    await setup.goto(`chrome-extension://${extId}/options.html`);
    await sleep(600);
    await setup.evaluate(async (verify) => {
      const cur = (await chrome.storage.local.get('wa.config'))['wa.config'] ?? {};
      const tools = ['read_page', 'find_element', 'scroll', 'wait', 'click', 'type', 'clear', 'select_option', 'press_key', 'navigate', 'go_back', 'go_forward', 'list_tabs', 'open_tab', 'switch_tab', 'close_tab'];
      const assistant = { id: 'agent-assistant', name: 'Assistant', description: '', avatar: { icon: 'Sparkles', color: '#10b981' }, instructions: '', providerId: null, model: '', temperature: 0, maxSteps: 20, confirmation: 'smart', toolIds: tools, skillIds: [], verify, createdAt: 1, updatedAt: 1 };
      await chrome.storage.local.set({
        'wa.config': {
          ...cur,
          agents: [assistant],
          providers: [{ id: 'mock', name: 'Mock', kind: 'openai', preset: 'custom', baseUrl: 'http://localhost:4600/v1', apiKey: '', defaultModel: 'mock-1', createdAt: 1 }],
          settings: { ...(cur.settings ?? {}), defaultAgentId: 'agent-assistant', defaultProviderId: 'mock', expandActivity: true, developerMode: false },
        },
      });
    }, verify);

    const panel = await browser.newPage();
    await panel.setViewport({ width: 400, height: 900 });
    await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
    await panel.waitForSelector('#composer-input');
    const site = await browser.newPage();
    await site.goto('http://localhost:4599/patients.html');
    await site.bringToFront();
    await sleep(600);
    await panel.$eval('#composer-input', (el) => el.focus());
    await panel.keyboard.type('Select Luke King');
    await panel.keyboard.press('Enter');
    await panel.waitForFunction(() => document.querySelector('.answer, .notice'), { timeout: 60000, polling: 300 });
    await sleep(300);
    const answer = await panel.$eval('.answer, .notice', (e) => e.textContent);
    const steps = await panel.$$eval('.steps .step-label', (els) => els.map((e) => e.textContent));
    const header = await site.$eval('#ctx', (e) => e.textContent);
    if (verify) {
      await panel.bringToFront();
      await sleep(200);
      await panel.screenshot({ path: join(OUT, 'panel-verify.png'), fullPage: true });
    }
    return { answer, steps, header };
  } finally {
    await browser.close();
  }
}

try {
  const without = await run(false);
  check('control: without the double-check the made-up answer goes through', /MRN-100076/.test(without.answer) && without.header === 'No patient selected', `${without.answer.slice(0, 70)} | page: ${without.header}`);

  const withCheck = await run(true);
  console.log('   steps:', withCheck.steps.join(' → '));
  check('double-check step ran', withCheck.steps.some((s) => /Double-checking/.test(s)));
  check('the patient is really selected now', withCheck.header === 'Selected patient: Luke King', withCheck.header);
  check('answer is grounded in the page', /MRN-104512/.test(withCheck.answer) && !/100076/.test(withCheck.answer), withCheck.answer.slice(0, 90));
} catch (err) {
  console.error('E2E error:', err);
  results.push(false);
} finally {
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
}
