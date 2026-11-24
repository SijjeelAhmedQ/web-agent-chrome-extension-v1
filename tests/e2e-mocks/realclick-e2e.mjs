// Pages that only react to real clicks: a patient that opens in a pop-up window, and an app that checks event.isTrusted.
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
const show = (r) => console.log(`   notes: ${r.notes.join(' | ')}\n   answer: ${r.answer.replace(/\n+/g, ' / ').slice(0, 300)}`);
const TOOLS = ['read_page', 'find_element', 'scroll', 'wait', 'click', 'click_text', 'type', 'clear', 'select_option', 'hover', 'open_menu', 'press_key', 'navigate', 'go_back', 'go_forward', 'list_tabs', 'open_tab', 'switch_tab', 'close_tab'];

const browser = await puppeteer.launch({ headless: true, protocolTimeout: 900000, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
try {
  const extId = new URL((await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'))).url()).host;
  const setup = await browser.newPage();
  await setup.goto(`chrome-extension://${extId}/options.html`);
  await sleep(600);
  const configure = (realClicks) =>
    setup.evaluate(
      async (realClicks, tools) => {
        const provider = { id: 'p', name: 'Mock', kind: 'openai', preset: 'custom', baseUrl: 'http://localhost:4600/v1', apiKey: '', defaultModel: 'mock-1', createdAt: 1 };
        const assistant = { id: 'agent-assistant', name: 'Assistant', description: '', avatar: { icon: 'Sparkles', color: '#10b981' }, instructions: '', providerId: null, model: '', temperature: 0.1, maxSteps: 25, confirmation: 'never', toolIds: tools, skillIds: [], createdAt: 1, updatedAt: 1 };
        await chrome.storage.session.remove('wa.chat');
        await chrome.storage.local.set({
          'wa.config': { version: 1, providers: [provider], agents: [assistant], skills: [], customTools: [], settings: { defaultProviderId: 'p', defaultAgentId: 'agent-assistant', developerMode: true, expandActivity: true, realClicks, knownToolIds: tools } },
        });
      },
      realClicks,
      TOOLS,
    );

  const run = async (query, realClicks) => {
    await configure(realClicks);
    const panel = await browser.newPage();
    await panel.setViewport({ width: 400, height: 900 });
    await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
    await panel.waitForSelector('#composer-input');
    const site = await browser.newPage();
    await site.setViewport({ width: 1200, height: 700 });
    await site.goto(`http://localhost:4599/legacy.html${query}`);
    await site.bringToFront();
    await sleep(400);
    await panel.$eval('#composer-input', (el) => el.focus());
    await panel.keyboard.type('Legacy real: Arya STARK');
    await panel.keyboard.press('Enter');
    const t0 = Date.now();
    while (!(await panel.$('.turn .activity.done, .turn .activity.failed'))) {
      if (Date.now() - t0 > 120000) throw new Error('timed out');
      await sleep(500);
    }
    const notes = await panel.$$eval('.turn:last-child .steps .step-note', (els) => els.map((e) => e.textContent));
    const answer = await panel.$eval('.turn:last-child', (e) => e.innerText);
    const result = await site.$eval('#result', (e) => e.textContent).catch(() => '(page gone)');
    const pages = await browser.pages();
    const tabs = pages.map((p) => p.url());
    // Close everything this run opened (a pop-up window would take the focus from the next run).
    for (const p of pages) if (p !== setup) await p.close().catch(() => undefined);
    return { notes, answer, result, tabs };
  };

  // 1) The patient opens in a pop-up: a script click is blocked, a real click opens it.
  let r = await run('?plain=1&popup=1', true);
  show(r);
  check('pop-up: the patient window opened', r.tabs.some((u) => u.includes('patients-page.html?chart=21-SHC-6844')), r.tabs.filter((u) => u.startsWith('http')).join(', '));
  check('pop-up: the agent moved to it', r.notes.includes('Opened in a new tab') && /you are now working there/.test(r.answer), r.answer.split('\n').find((l) => /OUT/.test(l)) ?? '');
  // 2) The app ignores script clicks (isTrusted): the real click opens the patient.
  r = await run('?plain=1&trusted=1', true);
  show(r);
  check('isTrusted app: opened by the real click', r.result === 'Opened patient: Arya STARK (21-SHC-6844)', r.result);
  // 3) With real clicks switched off, the agent is told nothing opened.
  r = await run('?plain=1&trusted=1', false);
  show(r);
  check('setting off: no real click, says only the look changed', r.result === 'Nothing opened' && r.notes.includes('Selected — nothing opened'), r.result);
  // 5) A slow app: the patient appears 1.5 s after the click.
  r = await run('?plain=1&slow=1', true);
  show(r);
  check('slow app: waited and saw it open (no real click)', r.result === 'Opened patient: Arya STARK (21-SHC-6844)' && r.notes.includes('The page changed') && !/real mouse click/.test(r.answer), r.notes.join(' | '));
  // 6) The patient opens in a modal with an iframe.
  r = await run('?plain=1&frame=1', true);
  show(r);
  check('iframe modal: counted as opened', r.notes.includes('The page changed') && /frame opened/.test(r.answer), r.answer.split('\n').find((l) => /OUT/.test(l))?.slice(0, 200) ?? '');
  // 4) A normal app: one ordinary click is enough (no real click needed).
  r = await run('?plain=1', true);
  show(r);
  check('normal app: opened with a normal click', r.result === 'Opened patient: Arya STARK (21-SHC-6844)' && !/real mouse click/.test(r.answer), r.result);
} catch (err) {
  console.error('E2E error:', err);
  results.push(false);
} finally {
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
}
