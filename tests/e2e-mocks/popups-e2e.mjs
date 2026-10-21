// Pop-ups on a consult: each listed with how to close it; the closable ones closed; the reason pop-up left for the user.
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
  await panel.$eval('#composer-input', (el) => el.focus());
  await panel.keyboard.type('popups');
  await panel.keyboard.press('Enter');
  const t0 = Date.now();
  while (!(await panel.$('.turn .activity.done, .turn .activity.failed'))) {
    if (Date.now() - t0 > 90000) throw new Error('timed out');
    await sleep(400);
  }
  await sleep(300);
  const answer = await panel.$eval('.turn:last-child', (e) => e.innerText);
  const flat = answer.replace(/\n/g, ' ');
  const first = (flat.match(/FIRST (.*?) LAST/) ?? [])[1] ?? '';
  const last = (flat.match(/LAST (.*)$/) ?? [])[1] ?? '';
  check('read_page lists each pop-up and how to close it', /"Alerts" — can be closed: \[\d+\] button "×"/.test(first) && /"Recalls due" — can be closed: \[\d+\] button "Close"/.test(first) && /"Add reason to view patient file" — has no ×, Close or Cancel button/.test(first), first.slice(0, 300));
  const shown = await page.evaluate(() => ['m1', 'm2', 'm3'].map((id) => getComputedStyle(document.getElementById(id)).display !== 'none'));
  check('the closable ones were closed; the reason pop-up is left for the user', JSON.stringify(shown) === '[false,false,true]' && /"Add reason to view patient file" — has no ×/.test(last) && !/Alerts/.test(last), `${JSON.stringify(shown)} · ${last.slice(0, 160)}`);
} catch (err) {
  console.error('E2E error:', err);
  results.push(false);
} finally {
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
}
