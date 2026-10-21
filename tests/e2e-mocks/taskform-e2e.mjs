// read_records: a whole inbox read in one step with the viewer's Next, then closed; nothing changed.
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
  const ask = async (text) => {
    const before = await panel.$$eval('.turn', (t) => t.length);
    await panel.$eval('#composer-input', (el) => el.focus());
    await panel.keyboard.type(text);
    await panel.keyboard.press('Enter');
    const t0 = Date.now();
    let approval = '';
    for (;;) {
      if (Date.now() - t0 > 90000) throw new Error('timed out');
      if (await panel.$('.approval')) {
        approval = await panel.$eval('.approval-title', (e) => e.textContent);
        await panel.$eval('.approval .ant-btn-primary', (b) => b.click());
      }
      const done = await panel.$$eval('.turn', (t, n) => t.length > n && !!t.at(-1).querySelector('.activity.done, .activity.failed'), before);
      if (done) break;
      await sleep(400);
    }
    await sleep(300);
    return { answer: await panel.$eval('.turn:last-child', (e) => e.innerText), approval };
  };
  await page.goto('http://localhost:4599/addtask.html');
  await page.bringToFront();
  await sleep(400);
  const r = await ask('task form');
  const flat = r.answer.replace(/\n/g, ' ');
  const form = (flat.match(/FORM (.*?) DUE /) ?? [])[1] ?? '';
  check('the form is read live — every field by its name on the form, * for required, what it holds now',
    /Subject \/ Progress\* — text box: empty/.test(form) &&
    /To\* — picker that can hold several: “PM Judy GILMOUR \(Practice Manager\)”/.test(form) &&
    /Priority\* — choose one: Normal \(chosen\) \/ Medium \/ Urgent/.test(form) &&
    /Start\* — date \(DD\/MM\/YYYY\): “21\/10\/2026”/.test(form) &&
    /Due-in — text: empty/.test(form) &&
    /Due\* — date \(DD\/MM\/YYYY\): “21\/10\/2026”/.test(form) &&
    /Type — dropdown: empty; options: call back task \/ Referral follow-up \/ Remind Me/.test(form) &&
    /Confidential — tick box: not ticked/.test(form) &&
    /From — text: “Chadmin CHADMIN \(Doctor\)” \(can’t be changed here\)/.test(form),
    form);
  check('a date box shown as “__/__/____” is called by its label', /DUE \[\d+\] textbox "Due"/.test(flat), (flat.match(/DUE .*? SAVE/) ?? [''])[0]);
  const clicked = await page.evaluate(() => window.__clicked);
  check('“Save” with the pop-up in front is the pop-up’s Save — not the page’s behind it', clicked === 'dialog-save' && !/2 matches/.test(flat), `${clicked} · ${(flat.match(/SAVE .*/) ?? [''])[0].slice(0, 160)}`);
  // A date typed in full: the calendar it opened closes (Tab, then a press beside it) — the pop-up stays.
  await page.goto('http://localhost:4599/addtask.html');
  await page.bringToFront();
  await sleep(800);
  await page.click('#due');
  await sleep(400);
  const openBefore = await page.evaluate(() => window.__pickerOpen());
  const d = await ask('date type');
  const after = await page.evaluate(() => ({ open: window.__pickerOpen(), value: document.getElementById('due').value, modal: getComputedStyle(document.querySelector('.modal')).display }));
  check('after typing a date the calendar is closed, the date kept and the pop-up open', openBefore && !after.open && after.value === '28/10/2026' && after.modal === 'block', `before=${openBefore} ${JSON.stringify(after)} · ${d.answer.replace(/\n/g, ' ').slice(-160)}`);
} catch (err) {
  console.error('E2E error:', err);
  results.push(false);
} finally {
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`${results.length - failed}/${results.length} checks passed`);
}
