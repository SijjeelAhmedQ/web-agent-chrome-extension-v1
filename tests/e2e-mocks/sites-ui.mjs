// Site-based setup: create Indici from its template, teach it something, preview it, and check the agent gets it on that site only.
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
const clickText = (page, sel, text) =>
  page.evaluate(
    (sel, text) => {
      const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.includes(text));
      if (!el) return false;
      el.click();
      return true;
    },
    sel,
    text,
  );
const TOOLS = ['read_page', 'find_element', 'scroll', 'wait', 'click', 'click_text', 'type', 'clear', 'select_option', 'hover', 'open_menu', 'press_key', 'navigate', 'go_back', 'go_forward', 'list_tabs', 'open_tab', 'switch_tab', 'close_tab'];

const browser = await puppeteer.launch({ headless: true, protocolTimeout: 900000, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
try {
  const extId = new URL((await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'))).url()).host;
  const opt = await browser.newPage();
  await opt.setViewport({ width: 1280, height: 900 });
  await opt.goto(`chrome-extension://${extId}/options.html`);
  await sleep(600);
  await opt.evaluate(async (tools) => {
    const provider = { id: 'p', name: 'Mock', kind: 'openai', preset: 'custom', baseUrl: 'http://localhost:4600/v1', apiKey: '', defaultModel: 'mock-1', createdAt: 1 };
    const assistant = { id: 'agent-assistant', name: 'Assistant', description: '', avatar: { icon: 'Sparkles', color: '#10b981' }, instructions: '', providerId: null, model: '', temperature: 0.1, maxSteps: 25, confirmation: 'never', toolIds: tools, skillIds: [], createdAt: 1, updatedAt: 1 };
    await chrome.storage.local.set({ 'wa.config': { version: 1, providers: [provider], agents: [assistant], skills: [], customTools: [], settings: { defaultProviderId: 'p', defaultAgentId: 'agent-assistant', developerMode: true, expandActivity: true, knownToolIds: tools } } });
  }, TOOLS);

  // 1) Sites page, empty; create Indici from the template with the test site's address.
  await opt.goto(`chrome-extension://${extId}/options.html#/sites`);
  await sleep(800);
  const nav = await opt.$eval('.sidebar-nav', (n) => n.innerText);
  check('navigation shows Extension base and Site base', /Extension base/i.test(nav) && /Site base/i.test(nav) && /Sites/.test(nav), nav.replace(/\n+/g, ' | ').slice(0, 160));
  await opt.screenshot({ path: join(OUT, 'sites-empty.png') });
  await clickText(opt, 'button', 'From a template');
  await sleep(400);
  check('template menu offers Indici', await clickText(opt, '.ant-dropdown-menu-item', 'Indici PMS'));
  await sleep(500);
  const okDisabled = await opt.$eval('.ant-modal .ant-btn-primary', (b) => b.disabled);
  check('an address is required before creating', okDisabled);
  await opt.click('.ant-modal .ant-select-selector');
  await opt.keyboard.type('localhost:4599');
  await opt.keyboard.press('Enter');
  await sleep(200);
  await opt.$eval('.ant-modal .ant-btn-primary', (b) => b.click());
  await sleep(900);
  const head = await opt.$eval('.site-head', (h) => h.innerText);
  check('opens the new site', /Indici/.test(head) && /localhost:4599/.test(head), head.replace(/\n+/g, ' | '));
  const rows = await opt.$$eval('.list-row .list-title', (els) => els.map((e) => e.textContent));
  check('template brought 4 knowledge entries', rows.length === 4 && rows.some((r) => /Select a patient from Search & List/.test(r)), rows.join(' | '));
  await opt.screenshot({ path: join(OUT, 'sites-knowledge.png') });

  // 2) Teach it something new: a rule.
  await clickText(opt, 'button', 'Add knowledge');
  await sleep(400);
  await clickText(opt, '.ant-dropdown-menu-item', 'Rule');
  await sleep(500);
  await opt.type('#kb-title', 'My own rule from the test');
  await opt.type('#kb-content', 'Never open Search Vault.');
  await opt.screenshot({ path: join(OUT, 'sites-entry.png') });
  await clickText(opt, '.ant-modal .ant-btn-primary', 'Add');
  await sleep(600);
  const rows2 = await opt.$$eval('.list-row .list-title', (els) => els.map((e) => e.textContent));
  check('the new rule is in the knowledge base', rows2.includes('My own rule from the test'), `${rows2.length} entries`);

  // 3) Preview: the workflow matching the example comes in full.
  await clickText(opt, '.ant-tabs-tab', 'Preview');
  await sleep(500);
  const preview = await opt.$eval('.site-preview', (p) => p.textContent);
  check('preview shows what the agent gets', /### Workflow: Select a patient from Search & List/.test(preview) && /My own rule from the test/.test(preview));
  await opt.screenshot({ path: join(OUT, 'sites-preview.png') });

  // 4) Site-level tool switch: navigate off on this site.
  await clickText(opt, '.ant-tabs-tab', 'Tools');
  await sleep(500);
  for (let i = 0; i < 5 && !(await opt.$('button[aria-label="Go to address on Indici"]')); i++) {
    await opt.$eval('.acc-panel.open .pager button[aria-label="Next page"]', (b) => b.click());
    await sleep(250);
  }
  await opt.$eval('button[aria-label="Go to address on Indici"]', (b) => b.click());
  await sleep(300);
  const saved = await opt.evaluate(async () => (await chrome.storage.local.get('wa.config'))['wa.config'].sites);
  check('saved: address, 5 entries, navigate off', saved.length === 1 && saved[0].sites[0] === 'localhost:4599' && saved[0].knowledge.length === 5 && saved[0].disabledToolIds.includes('navigate'), JSON.stringify(saved.map((s) => ({ n: s.name, k: s.knowledge.length, off: s.disabledToolIds }))));

  // 5) Phone width.
  await opt.setViewport({ width: 390, height: 844 });
  await clickText(opt, '.ant-tabs-tab', 'Knowledge');
  await sleep(400);
  await opt.screenshot({ path: join(OUT, 'sites-phone.png'), fullPage: true });
  check('no sideways scroll on a phone', !(await opt.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));

  // 6) The agent on that site: knowledge in the prompt, site_knowledge tool, navigate switched off. Elsewhere: none of it.
  const ask = async (url) => {
    const panel = await browser.newPage();
    await panel.setViewport({ width: 400, height: 900 });
    await panel.evaluate(() => chrome?.storage?.session?.remove?.('wa.chat')).catch(() => undefined);
    await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
    await panel.evaluate(() => chrome.storage.session.remove('wa.chat'));
    await panel.reload();
    await panel.waitForSelector('#composer-input');
    const site = await browser.newPage();
    await site.goto(url);
    await site.bringToFront();
    await sleep(900);
    const chips = await panel.$eval('.runtime-bar', (b) => b.innerText).catch(() => '');
    await panel.$eval('#composer-input', (el) => el.focus());
    await panel.keyboard.type('kb check: goto patients and select Search & List and select Arya Stark');
    await panel.keyboard.press('Enter');
    const t0 = Date.now();
    while (!(await panel.$('.turn .activity.done, .turn .activity.failed, .turn .notice'))) {
      if (Date.now() - t0 > 60000) break;
      await sleep(400);
    }
    await sleep(300);
    const answer = await panel.$eval('.turn:last-child', (e) => e.innerText).catch(() => '');
    if (/localhost:4599/.test(url)) await panel.screenshot({ path: join(OUT, 'sites-panel.png') });
    await site.close();
    await panel.close();
    return { chips, answer };
  };
  let r = await ask('http://localhost:4599/legacy.html?plain=1');
  check('side panel shows the Indici chip', /Indici/.test(r.chips), r.chips.replace(/\n+/g, ' '));
  const line = r.answer.split('\n').find((l) => /KB /.test(l)) ?? r.answer.slice(0, 200);
  check('on the site: knowledge, workflow, my rule and site_knowledge given; navigate off', /KB yes WF yes MINE yes TOOL yes NAV no/.test(line), line);
  r = await ask('http://127.0.0.1:4599/legacy.html?plain=1');
  const line2 = r.answer.split('\n').find((l) => /KB /.test(l)) ?? r.answer.slice(0, 200);
  check('on another site: none of it', /KB no WF no MINE no TOOL no NAV yes/.test(line2) && !/Indici/.test(r.chips), line2);
} catch (err) {
  console.error('E2E error:', err);
  results.push(false);
} finally {
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
}
