// Nested navigation menus: CSS-only :hover (3 levels), JavaScript mouseenter, and a click-to-open button.
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
      ? [
          ['Open Gaming laptops from the top menu: Products, then Laptops, then Gaming laptops.', 'Chose: Gaming laptops'],
          ['In the Services menu, go to Cloud and open Storage.', 'Chose: Storage'],
          ['Open Orders from the Account menu.', 'Chose: Orders'],
        ]
      : [
          ['Menu css: Products › Laptops › Gaming laptops', 'Chose: Gaming laptops'],
          ['Menu js: Services › Cloud › Storage', 'Chose: Storage'],
          ['Menu click: Account › Orders', 'Chose: Orders'],
          ['Menu leaf: Account › Delete account', 'Nothing chosen'],
        ];
  let turn = 0;
  const approvalsSeen = [];
  for (const [request, expected] of tasks) {
    await site.goto('http://localhost:4599/menus.html');
    await site.bringToFront();
    await sleep(500);
    // Sanity: a synthetic mouseover alone can't open a CSS :hover menu.
    if (turn === 0) {
      const opensWithEventsOnly = await site.evaluate(() => {
        const top = document.querySelector('.css-nav');
        top.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        return getComputedStyle(top.querySelector('.menu')).display !== 'none';
      });
      check('control: plain synthetic events do not open the CSS menu', !opensWithEventsOnly);
    }
    turn++;
    await panel.$eval('#composer-input', (el) => el.focus());
    await panel.keyboard.type(request);
    await panel.keyboard.press('Enter');
    const t0 = Date.now();
    for (;;) {
      const s = await panel.evaluate((n) => ({
        done: document.querySelectorAll('.turn .activity.done, .turn .activity.failed, .turn .activity.cancelled, .turn .notice').length >= n,
        approval: !!document.querySelector('.approval'),
      }), turn);
      if (s.done) break;
      if (s.approval) {
        approvalsSeen.push(await panel.$eval('.approval-title', (e) => e.textContent));
        // Never approve deleting anything in a test.
        const deny = /delete/i.test(approvalsSeen.at(-1));
        await panel.$eval(deny ? '.approval .ant-btn-default' : '.approval .ant-btn-primary', (b) => b.click());
      }
      if (Date.now() - t0 > 480000) throw new Error('timed out');
      await sleep(800);
    }
    const result = await site.$eval('#result', (e) => e.textContent);
    const steps = await panel.$$eval('.turn:last-child .steps .step-label', (els) => els.map((e) => e.textContent));
    console.log(`   ${request.slice(0, 40)} → ${steps.join(' → ')} (${Math.round((Date.now() - t0) / 1000)}s)`);
    check(`${request.split(':')[0]} reached “${expected.slice(7)}”`, result === expected, result);
    if (turn === 1) {
      await site.screenshot({ path: join(OUT, `menu-${MODE}-site.png`) });
    }
  }
  if (MODE !== 'kaggle') check('open_menu never clicks the final item; the click asks first', approvalsSeen.some((t) => /Delete account/.test(t)), approvalsSeen.join(' | '));
  // The configuration page shows the migrated agent with the two new tools (16 → 18).
  await setup.goto(`chrome-extension://${extId}/options.html#/agents`);
  await sleep(700);
  const card = await setup.$eval('.agent-card', (e) => e.textContent);
  check('saved agents got hover, open_menu and click_text', /19 tools/.test(card), card.match(/\d+ tools/)?.[0] ?? card.slice(0, 60));
  await panel.bringToFront();
  await sleep(300);
  await panel.screenshot({ path: join(OUT, `menu-${MODE}-panel.png`), fullPage: true });
} catch (err) {
  console.error('E2E error:', err);
  results.push(false);
} finally {
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
}
