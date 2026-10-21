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
  await page.goto('http://localhost:4599/inbox-status.html');
  await page.bringToFront();
  await sleep(400);
  const r = await ask('records status');
  const flat = r.answer.replace(/\n/g, ' ');
  check('Arya’s 4 lab records: 3 abnormal, 1 normal — the flag is the right-hand column, whatever the middle says', /Totals: 4 records — 3 abnormal, 1 normal\./.test(flat), (flat.match(/Results by.*?Totals[^|]*/) ?? [flat.slice(0, 600)])[0]);
  check('each abnormal test is named with its flag', /Record 1 \(Testing · 21-10-2026\): ABNORMAL — HbA1c: Abnormal; Blood Culture: Abnormal alert; Blood Culture: better; Blood Group Ab \(interpretation\): decreased; Blood Test: High; Cadmium blood: intermediate; CO2 blood \( total\): increased · 1 normal \(Bicarbonate blood\)/.test(flat) && /Record 2 \(Test Web Agent · 21-10-2026\): ABNORMAL — Blood Test: Abnormal/.test(flat) && /Record 3 \(Test · 21-10-2026\): NORMAL/.test(flat) && /Record 4 \(test result normal · 21-10-2026\): ABNORMAL — HbA1c: Abnormal · 1 normal \(Blood Test\)/.test(flat), '');
  const t = await ask('list colours');
  check('read_table gives each row of the list with its colour, and counts them — no record opened', /LIST 4 rows\./.test(t.answer) && /Testing \| — \| — — in red/.test(t.answer.replace(/\n/g, ' ')) && /By colour: 3 in red, 1 in grey\./.test(t.answer), t.answer.replace(/\n/g, ' ').slice(-700));
  check('a dropdown’s options are not in the record text — its choice is', !/ACC45 code 12 /.test(flat) && !/Provider number 3 /.test(flat) && /Provider: Provider number 7 Chadmin/.test(flat), '');
  const m = await ask('manual next');
  check('paging through records by hand with the viewer’s Next is stopped once — read_records instead', /NEXT Not clicked: to go through the records of a list/.test(m.answer) && /Use read_records/.test(m.answer), m.answer.replace(/\n/g, ' ').slice(0, 300));
} catch (err) {
  console.error('E2E error:', err);
  results.push(false);
} finally {
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`${results.length - failed}/${results.length} checks passed`);
}
