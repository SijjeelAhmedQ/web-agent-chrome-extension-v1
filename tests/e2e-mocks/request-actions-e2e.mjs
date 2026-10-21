// Copy and Run again under the user's request.
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
const TOOLS = ['read_page', 'find_element', 'scroll', 'wait', 'click', 'click_text', 'type', 'clear', 'select_option', 'hover', 'open_menu', 'press_key', 'navigate', 'go_back', 'go_forward', 'list_tabs', 'open_tab', 'switch_tab', 'close_tab'];

const browser = await puppeteer.launch({ headless: true, protocolTimeout: 900000, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
try {
  const extId = new URL((await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'))).url()).host;
  const panel = await browser.newPage();
  await panel.setViewport({ width: 400, height: 900 });
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  await panel.evaluate(async (tools) => {
    const provider = { id: 'p', name: 'Mock', kind: 'openai', preset: 'custom', baseUrl: 'http://localhost:4600/v1', apiKey: '', defaultModel: 'mock-1', createdAt: 1 };
    const agent = { id: 'agent-assistant', name: 'Assistant', description: '', avatar: { icon: 'Sparkles', color: '#10b981' }, instructions: '', providerId: null, model: '', temperature: 0.1, maxSteps: 25, confirmation: 'smart', toolIds: tools, skillIds: [], createdAt: 1, updatedAt: 1 };
    const site = { id: 'site_t', name: 'indici training', description: '', color: '#0e7490', sites: ['localhost:4599'], enabled: true, providerId: null, model: '', agentIds: [], skillIds: [], disabledSkillIds: [], customToolIds: [], disabledToolIds: [], neverClick: ['Pharmac'], knowledge: [], createdAt: 1, updatedAt: 1 };
    await chrome.storage.session.remove('wa.chat');
    await chrome.storage.local.set({ 'wa.config': { version: 1, providers: [provider], agents: [agent], skills: [], customTools: [], sites: [site], settings: { defaultProviderId: 'p', defaultAgentId: 'agent-assistant', developerMode: true, expandActivity: true, knownToolIds: tools } } });
  }, TOOLS);
  const page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 700 });
  await panel.evaluate(() => chrome.storage.session.remove('wa.chat'));
  await page.goto('http://localhost:4599/popups.html');
  await page.bringToFront();
  await panel.reload();
  await panel.waitForSelector('#composer-input');
  await sleep(500);
  const waitDone = async (n) => {
    const t0 = Date.now();
    while (!(await panel.$$eval('.turn', (t, n) => t.length >= n && !!t.at(-1).querySelector('.activity.done, .activity.failed'), n))) {
      if (Date.now() - t0 > 90000) throw new Error('timed out');
      await sleep(300);
    }
    await sleep(300);
  };
  await panel.$eval('#composer-input', (el) => el.focus());
  await panel.keyboard.type('reason ask');
  await panel.keyboard.press('Enter');
  await panel.waitForSelector('.turn .request-actions');
  const whileBusy = await panel.$eval('.turn .request-actions [aria-label="Run this request again"]', (b) => b.disabled);
  await waitDone(1);
  const labels = await panel.$$eval('.turn .request-actions button', (bs) => bs.map((b) => `${b.getAttribute('aria-label')}${b.disabled ? ' (disabled)' : ''}`));
  check('the request has Copy and Run again; Run again waits while the agent works', whileBusy && JSON.stringify(labels) === '["Copy request","Run this request again"]', `busy=${whileBusy} · ${labels.join(', ')}`);
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(`chrome-extension://${extId}`, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  await panel.bringToFront();
  await panel.click('.turn .request-actions [aria-label="Copy request"]');
  await sleep(300);
  const copied = await panel.evaluate(() => navigator.clipboard.readText()).catch((e) => `ERR ${e.message}`);
  check('Copy puts the request on the clipboard', copied === 'reason ask', copied);
  await panel.click('.turn .activity-copy');
  await sleep(300);
  const steps = await panel.evaluate(() => navigator.clipboard.readText()).catch((e) => `ERR ${e.message}`);
  check('Copy steps puts each step, how it went and its note on the clipboard', /^Clicking “Close”\r?\n(Done|Failed|Skipped)/.test(steps), JSON.stringify(steps.slice(0, 120)));
  await page.goto('http://localhost:4599/popups.html');
  await panel.bringToFront();
  await panel.click('.turn .request-actions [aria-label="Run this request again"]');
  await waitDone(2);
  const reqs = await panel.$$eval('.turn .user-msg .bubble', (bs) => bs.map((b) => b.textContent));
  check('Run again sends the same request as a new turn', JSON.stringify(reqs) === '["reason ask","reason ask"]', reqs.join(' | '));
  const rerun = await panel.$eval('.turn:last-child', (e) => e.innerText);
  check('Run again starts fresh, not as a reply to the question', !/Already done before asking you/.test(rerun) && /Clicking “Close”/.test(rerun), rerun.slice(0, 200).replace(/\n/g, ' '));
  for (const theme of ['light', 'dark']) {
    await panel.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
    await panel.hover('.turn:last-child .user-msg .bubble');
    await sleep(250);
    await panel.screenshot({ path: join(OUT, `request-actions-${theme}.png`) });
  }
} catch (err) {
  console.error('E2E error:', err);
  results.push(false);
} finally {
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
}
