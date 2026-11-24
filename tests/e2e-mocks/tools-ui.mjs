// Tools page: open a built-in tool, see what the model is told, edit it, and check the agent uses the edit.
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
  page.evaluate((sel, text) => {
    const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.includes(text));
    if (!el) return false;
    el.click();
    return true;
  }, sel, text);

const browser = await puppeteer.launch({ headless: true, protocolTimeout: 900000, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
try {
  const extId = new URL((await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'))).url()).host;
  const opt = await browser.newPage();
  await opt.setViewport({ width: 1280, height: 900 });
  await opt.goto(`chrome-extension://${extId}/options.html`);
  await sleep(600);
  await opt.evaluate(async () => {
    const provider = { id: 'p', name: 'Mock', kind: 'openai', preset: 'custom', baseUrl: 'http://localhost:4600/v1', apiKey: '', defaultModel: 'mock-1', createdAt: 1 };
    const legacy = ['read_page', 'find_element', 'scroll', 'wait', 'click', 'type', 'clear', 'select_option', 'press_key', 'navigate', 'go_back', 'go_forward', 'list_tabs', 'open_tab', 'switch_tab', 'close_tab'];
    const assistant = { id: 'agent-assistant', name: 'Assistant', description: '', avatar: { icon: 'Sparkles', color: '#10b981' }, instructions: '', providerId: null, model: '', temperature: 0.1, maxSteps: 25, confirmation: 'smart', toolIds: legacy, skillIds: [], createdAt: 1, updatedAt: 1 };
    await chrome.storage.local.set({ 'wa.config': { version: 1, providers: [provider], agents: [assistant], skills: [], customTools: [], settings: { defaultProviderId: 'p', defaultAgentId: 'agent-assistant', developerMode: true, expandActivity: true } } });
  });
  await opt.goto(`chrome-extension://${extId}/options.html#/tools`);
  await sleep(900);
  check('built-in tool rows open', await clickText(opt, '.tool-row', 'Click text'));
  await sleep(700);
  const drawer = await opt.$eval('.ant-drawer-content', (d) => d.innerText);
  check('shows what the agent is told', /What the agent is told/.test(drawer) && /Inputs/.test(drawer) && /near/.test(drawer) && /required/i.test(drawer), drawer.slice(0, 120).replace(/\n/g, ' | '));
  const defaultDesc = await opt.$eval('#tool-model-desc', (t) => t.value);
  check('description box holds the real default', /Click visible text/.test(defaultDesc), defaultDesc.slice(0, 60));
  // Edit: add a rule to the description and to the near input; turn on "always ask".
  await opt.$eval('#tool-model-desc', (t) => t.focus());
  await opt.$eval('#tool-model-desc', (t) => t.setSelectionRange(t.value.length, t.value.length));
  await opt.keyboard.type(' On our PMS, open a patient by clicking the name, never an icon.');
  const nearInput = await opt.$('input[aria-label="What the agent is told about near"]');
  await nearInput.click();
  await nearInput.evaluate((i) => i.select());
  await opt.keyboard.type('The date of birth shown in the same row');
  await opt.$eval('button[aria-label="Always ask before using it"]', (b) => b.click());
  await clickText(opt, '.ant-collapse-header', 'Exactly what the model receives');
  await sleep(400);
  const json = await opt.$eval('.spec-json', (p) => p.textContent);
  check('live preview shows the edits', /never an icon/.test(json) && /date of birth shown in the same row/.test(json));
  await opt.screenshot({ path: join(OUT, 'tools-drawer.png') });
  await clickText(opt, '.drawer-foot button', 'Save changes');
  await sleep(700);
  const row = await opt.evaluate(() => [...document.querySelectorAll('.tool-row')].find((r) => r.textContent.includes('Click text'))?.textContent ?? '');
  check('row shows Edited and Always asks', /Edited/.test(row) && /Always asks/.test(row), row.slice(0, 120));
  const saved = await opt.evaluate(async () => (await chrome.storage.local.get('wa.config'))['wa.config'].settings.toolOverrides);
  check('saved only the changes', !!saved?.click_text?.description && saved.click_text.params?.near === 'The date of birth shown in the same row' && !('text' in (saved.click_text.params ?? {})) && saved.click_text.alwaysAsk === true, JSON.stringify(saved).slice(-260));
  await opt.screenshot({ path: join(OUT, 'tools-page.png') });

  // Phone width
  await opt.setViewport({ width: 390, height: 844 });
  await sleep(300);
  await clickText(opt, '.tool-row', 'Click text');
  await sleep(600);
  await opt.screenshot({ path: join(OUT, 'tools-drawer-phone.png') });
  const overflow = await opt.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  check('no sideways scroll on a phone', !overflow);
  await opt.keyboard.press('Escape');

  // The agent gets the edited tool, and "always ask" asks.
  const panel = await browser.newPage();
  await panel.setViewport({ width: 400, height: 900 });
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  await panel.waitForSelector('#composer-input');
  const site = await browser.newPage();
  await site.goto('http://localhost:4599/legacy.html?plain=1');
  await site.bringToFront();
  await sleep(400);
  await panel.$eval('#composer-input', (el) => el.focus());
  await panel.keyboard.type('Legacy plain: Arya STARK');
  await panel.keyboard.press('Enter');
  let asked = '';
  const t0 = Date.now();
  for (;;) {
    const s = await panel.evaluate(() => ({ done: !!document.querySelector('.turn .activity.done, .turn .activity.failed'), approval: document.querySelector('.approval-title')?.textContent ?? '' }));
    if (s.done) break;
    if (s.approval) {
      asked ||= s.approval;
      await panel.$eval('.approval .ant-btn-primary', (b) => b.click());
    }
    if (Date.now() - t0 > 120000) throw new Error('timed out');
    await sleep(500);
  }
  check('always ask: the agent asked before click_text', /Arya STARK/.test(asked), asked);
  check('then it opened the right patient', (await site.$eval('#result', (e) => e.textContent)) === 'Opened patient: Arya STARK (21-SHC-6844)');
} catch (err) {
  console.error('E2E error:', err);
  results.push(false);
} finally {
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
}
