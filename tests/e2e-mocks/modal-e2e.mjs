// The consult's "reason" modal: Save is an <input type=button> (and, in a variant, inside an iframe);
// clicking Clear on an empty field is not a failure and opens no debugger; click_text stops after two misses.
import puppeteer from 'puppeteer';

const EXT = process.argv[2];
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
  for (const variant of ['', '?frame=1']) {
    const panel = await browser.newPage();
    await panel.setViewport({ width: 400, height: 900 });
    await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
    await panel.evaluate(async (tools) => {
      const provider = { id: 'p', name: 'Mock', kind: 'openai', preset: 'custom', baseUrl: 'http://localhost:4600/v1', apiKey: '', defaultModel: 'mock-1', createdAt: 1 };
      const agent = { id: 'agent-assistant', name: 'Assistant', description: '', avatar: { icon: 'Sparkles', color: '#10b981' }, instructions: '', providerId: null, model: '', temperature: 0.1, maxSteps: 25, confirmation: 'smart', toolIds: tools, skillIds: [], createdAt: 1, updatedAt: 1 };
      await chrome.storage.session.remove('wa.chat');
      await chrome.storage.local.set({ 'wa.config': { version: 1, providers: [provider], agents: [agent], skills: [], customTools: [], sites: [], settings: { defaultProviderId: 'p', defaultAgentId: 'agent-assistant', developerMode: true, expandActivity: true, knownToolIds: tools } } });
    }, TOOLS);
    const site = await browser.newPage();
    await site.setViewport({ width: 1100, height: 700 });
    await site.goto(`http://localhost:4599/consult.html${variant}`);
    await site.bringToFront();
    await panel.reload();
    await panel.waitForSelector('#composer-input');
    await sleep(500);
    await panel.$eval('#composer-input', (el) => el.focus());
    await panel.keyboard.type('consult modal, reason: i am testing');
    await panel.keyboard.press('Enter');
    let approval = '';
    const t0 = Date.now();
    while (!(await panel.$('.turn .activity.done, .turn .activity.failed'))) {
      if (await panel.$('.approval')) {
        approval = await panel.$eval('.approval-title', (e) => e.textContent);
        await panel.$eval('.approval .ant-btn-primary', (b) => b.click());
      }
      if (Date.now() - t0 > 120000) throw new Error('timed out');
      await sleep(300);
    }
    const took = Date.now() - t0;
    const notes = await panel.$$eval('.turn:last-child .steps .step-note', (els) => els.map((e) => e.textContent));
    const answer = await panel.$eval('.turn:last-child', (e) => e.innerText);
    const result = await site.$eval('#result', (e) => e.textContent);
    const label = variant ? 'modal in an iframe' : 'modal in the page';
    check(`${label}: Save (an input button) found by click_text, asked first, saved`, result === 'Saved: i am testing' && /Save/.test(approval), `${result} · approval “${approval}”`);
    check(`${label}: Clear with nothing to clear is not a failure, no real click`, notes[1] === 'Nothing changed' && !/real mouse click/.test(answer) && took < 60000, `${notes.slice(0, 3).join(' | ')} · ${Math.round(took / 1000)}s`);
    check(`${label}: a third click_text for missing text is refused`, notes.filter((n) => n === 'Text not found').length === 2 && notes.includes('Not found twice — use the element list'), notes.slice(3).join(' | '));
    await site.close();
    await panel.close();
  }
} catch (err) {
  console.error('E2E error:', err);
  results.push(false);
} finally {
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
}
