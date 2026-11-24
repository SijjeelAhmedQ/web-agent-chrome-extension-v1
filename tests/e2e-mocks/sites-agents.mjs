// Site base → Agents tab, bulk switches, and the site's agent taking over in the side panel.
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
      const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.trim() === text || e.textContent.includes(text));
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
  await opt.setViewport({ width: 1280, height: 1000 });
  await opt.goto(`chrome-extension://${extId}/options.html`);
  await sleep(600);
  // Two agents; the site (like the user's) has reading switched off and one site skill.
  await opt.evaluate(async (tools) => {
    const provider = { id: 'p', name: 'Mock', kind: 'openai', preset: 'custom', baseUrl: 'http://localhost:4600/v1', apiKey: '', defaultModel: 'mock-1', createdAt: 1 };
    const agent = (id, name, skillIds) => ({ id, name, description: '', avatar: { icon: 'Sparkles', color: '#10b981' }, instructions: '', providerId: null, model: '', temperature: 0.1, maxSteps: 25, confirmation: 'never', toolIds: tools, skillIds, createdAt: 1, updatedAt: 1 });
    const skill = (id, name) => ({ id, name, description: '', instructions: `SKILL-MARKER ${name}`, activation: 'always', sites: [], createdAt: 1, updatedAt: 1 });
    const site = { id: 'site_t', name: 'indici training', description: '', color: '#0e7490', sites: ['localhost:4599'], enabled: true, providerId: null, model: '', agentIds: [], skillIds: ['site_skill'], disabledSkillIds: [], customToolIds: [], disabledToolIds: ['read_page', 'find_element', 'scroll'], knowledge: [], createdAt: 1, updatedAt: 1 };
    await chrome.storage.local.set({
      'wa.config': {
        version: 1,
        providers: [provider],
        agents: [agent('agent-assistant', 'Assistant', []), agent('agent-pms', 'PMS agent', ['pms_skill'])],
        skills: [skill('site_skill', 'Site skill'), skill('pms_skill', 'PMS skill')],
        customTools: [],
        sites: [site],
        settings: { defaultProviderId: 'p', defaultAgentId: 'agent-assistant', developerMode: true, expandActivity: true, knownToolIds: tools },
      },
    });
  }, TOOLS);
  const sites = () => opt.evaluate(async () => (await chrome.storage.local.get('wa.config'))['wa.config'].sites[0]);

  await opt.goto(`chrome-extension://${extId}/options.html#/sites/site_t`);
  await sleep(900);
  await clickText(opt, '.ant-tabs-tab', 'Tools');
  await sleep(500);
  check('warns that reading is off', /agents can’t see the page here/.test(await opt.$eval('.ant-tabs-content', (e) => e.innerText)));
  await clickText(opt, 'button', 'Turn reading back on');
  await sleep(300);
  check('“Turn reading back on” fixes it', (await sites()).disabledToolIds.length === 0);
  await clickText(opt, '.acc-actions button', 'All off');
  await sleep(300);
  check('built-in tools: All off', (await sites()).disabledToolIds.length === TOOLS.length, `${(await sites()).disabledToolIds.length} off`);
  await clickText(opt, '.acc-actions button', 'All on');
  await sleep(300);
  check('built-in tools: All on', (await sites()).disabledToolIds.length === 0);

  // Agents tab: choose the PMS agent; its skill and tools are on; turn its skill off here.
  await clickText(opt, '.ant-tabs-tab', 'Agents');
  await sleep(500);
  await opt.$eval('input[aria-label="PMS agent works on indici training"]', (c) => c.click());
  await sleep(500);
  let s = await sites();
  check('agent chosen for the site', s.agentIds.join() === 'agent-pms');
  const body = await opt.$eval('.site-agent.on', (e) => e.innerText);
  check('its skills and tools show, switched on', /PMS skill/.test(body) && /Read page/.test(body) && (await opt.$$eval('.site-agent.on .ant-switch-checked', (els) => els.length)) >= TOOLS.length + 1, body.replace(/\n+/g, ' | ').slice(0, 160));
  await opt.screenshot({ path: join(OUT, 'site-agents.png') });
  await opt.$eval('button[aria-label="PMS skill on indici training"]', (b) => b.click());
  await sleep(300);
  s = await sites();
  check('its skill switched off on this site', s.disabledSkillIds.includes('pms_skill'));

  // Skills tab: the agent's skill shows (off); remove all of the site's own skills.
  await clickText(opt, '.ant-tabs-tab', 'Skills');
  await sleep(500);
  await clickText(opt, '.acc-actions button', 'Remove all');
  await sleep(400);
  await clickText(opt, '.ant-modal-confirm .ant-btn-dangerous', 'Remove all');
  await sleep(400);
  s = await sites();
  check('Remove all: site skills gone, the skill itself kept', s.skillIds.length === 0 && (await opt.evaluate(async () => (await chrome.storage.local.get('wa.config'))['wa.config'].skills.length)) === 2);
  await clickText(opt, '.acc-toggle', 'From the agents on this site');
  await sleep(400);
  const skillsTab = await opt.$eval('.ant-tabs-tabpane-active', (e) => e.innerText);
  check('Skills tab lists the agent’s skill under “From the agents”', /From the agents on this site/.test(skillsTab) && /PMS skill/.test(skillsTab));
  await opt.screenshot({ path: join(OUT, 'site-skills.png') });

  // Phone width
  await opt.setViewport({ width: 390, height: 844 });
  await clickText(opt, '.ant-tabs-tab', 'Agents');
  await sleep(400);
  await opt.screenshot({ path: join(OUT, 'site-agents-phone.png'), fullPage: true });
  check('no sideways scroll on a phone', !(await opt.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));

  // Side panel on the site: the PMS agent takes over; its switched-off skill is not in the prompt.
  const panel = await browser.newPage();
  await panel.setViewport({ width: 400, height: 900 });
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  await panel.evaluate(() => chrome.storage.session.remove('wa.chat'));
  const site = await browser.newPage();
  await site.goto('http://localhost:4599/legacy.html?plain=1');
  await site.bringToFront();
  await panel.reload();
  await panel.waitForSelector('#composer-input');
  await sleep(1200);
  await panel.$eval('#composer-input', (el) => el.focus());
  await panel.keyboard.type('kb check');
  await panel.keyboard.press('Enter');
  const t0 = Date.now();
  while (!(await panel.$('.turn .activity.done, .turn .activity.failed, .turn .notice')) && Date.now() - t0 < 60000) await sleep(400);
  await sleep(300);
  const answer = await panel.$eval('.turn:last-child', (e) => e.innerText).catch(() => '');
  const line = answer.split('\n').find((l) => /KB /.test(l)) ?? answer.slice(0, 200);
  check('on the site the PMS agent runs, reading on, its skill off', /READ yes SK no AG PMS agent/.test(line), line);
  await panel.screenshot({ path: join(OUT, 'site-agents-panel.png') });
  // The agent dropdown offers only the site's agents there — and every agent elsewhere.
  const menuNames = async () => {
    await panel.$eval('.agent-switch', (b) => b.click());
    await sleep(400);
    const out = await panel.$$eval('.agent-menu .agent-option-name', (els) => els.filter((e) => e.offsetParent).map((e) => e.textContent));
    const title = await panel.$eval('.agent-menu .ant-dropdown-menu-item-group-title', (e) => e.textContent).catch(() => '');
    await panel.keyboard.press('Escape');
    await sleep(300);
    return { out, title };
  };
  let m = await menuNames();
  check('on the site the dropdown lists only its agents', m.out.join() === 'PMS agent' && /Agents for indici training/.test(m.title), `${m.title}: ${m.out.join(', ')}`);
  await site.goto('http://127.0.0.1:4599/legacy.html?plain=1');
  await site.bringToFront();
  await sleep(1200);
  m = await menuNames();
  check('on another site every agent is listed', m.out.length === 2 && m.title === 'Agents', `${m.title}: ${m.out.join(', ')}`);
} catch (err) {
  console.error('E2E error:', err);
  results.push(false);
} finally {
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
}
