// A table-based medication form (like Indici): fields named by their labels; a never-click button is refused.
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
  await page.goto('http://localhost:4599/medform.html');
  await page.bringToFront();
  await panel.reload();
  await panel.waitForSelector('#composer-input');
  await sleep(600);
  await panel.$eval('#composer-input', (el) => el.focus());
  await panel.keyboard.type('med form: take two once daily for 30 days');
  await panel.keyboard.press('Enter');
  let approval = false;
  const t0 = Date.now();
  while (!(await panel.$('.turn .activity.done, .turn .activity.failed'))) {
    if (await panel.$('.approval')) approval = true;
    if (Date.now() - t0 > 90000) throw new Error('timed out');
    await sleep(400);
  }
  await sleep(300);
  const answer = await panel.$eval('.turn:last-child', (e) => e.innerText);
  const notes = await panel.$$eval('.turn:last-child .steps .step-note', (els) => els.map((e) => e.textContent));
  const names = answer.split('\n').find((l) => l.includes('NAMES')) ?? answer.slice(0, 600);
  check('fields named by their labels', /textbox "Take"/.test(names) && /select "Frequency"/.test(names) && /textbox "Duration"/.test(names) && /select "Duration"/.test(names) && /textbox "Find Medicine"/.test(names) && /textbox "Quantity"/.test(names), names);
  const form = await page.evaluate(() => ({ take: txtTake.value, freq: ddlFrequency.value, dur: txtDuration.value, result: document.getElementById('result').textContent }));
  check('filled by those names', form.take === '2' && form.freq === 'Once Daily' && form.dur === '30', JSON.stringify(form));
  check('Pharmac refused without asking, and not clicked', !approval && form.result === 'Nothing clicked' && notes.some((n) => /Pharmac.*for you to click/.test(n)), notes.join(' | '));
  check('the prompt names the never-click buttons', /KB yes/.test(answer));
  await panel.screenshot({ path: join(OUT, 'medform-panel.png') });
} catch (err) {
  console.error('E2E error:', err);
  results.push(false);
} finally {
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
}
