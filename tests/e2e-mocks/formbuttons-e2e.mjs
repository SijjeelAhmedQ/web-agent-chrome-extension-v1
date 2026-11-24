// A pop-up form's own buttons in the approval: the user picks one; Cancel here cancels there; closing
// the form on the page takes the question away.
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
  const panel = await browser.newPage();
  await panel.setViewport({ width: 420, height: 900 });
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  await panel.evaluate(async (tools) => {
    const provider = { id: 'p', name: 'Mock', kind: 'openai', preset: 'custom', baseUrl: 'http://localhost:4600/v1', apiKey: '', defaultModel: 'mock-1', createdAt: 1 };
    const agent = { id: 'agent-assistant', name: 'Assistant', description: '', avatar: { icon: 'Sparkles', color: '#10b981' }, instructions: '', providerId: null, model: '', temperature: 0.1, maxSteps: 25, confirmation: 'smart', toolIds: tools, skillIds: [], createdAt: 1, updatedAt: 1 };
    await chrome.storage.local.set({ 'wa.config': { version: 1, providers: [provider], agents: [agent], skills: [], customTools: [], sites: [], settings: { defaultProviderId: 'p', defaultAgentId: 'agent-assistant', developerMode: true, expandActivity: true, knownToolIds: tools } } });
  }, TOOLS);
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });

  // Sends a request; `onApproval(panel)` decides what to do with the card (null = leave it).
  const run = async (text, onApproval) => {
    await page.goto('http://localhost:4599/addtask.html');
    await page.bringToFront();
    await panel.evaluate(() => chrome.storage.session.remove('wa.chat'));
    await panel.reload();
    await panel.waitForSelector('#composer-input');
    await sleep(500);
    await panel.$eval('#composer-input', (el) => el.focus());
    await panel.keyboard.type(text);
    await panel.keyboard.press('Enter');
    let card = null;
    const t0 = Date.now();
    for (;;) {
      if (Date.now() - t0 > 90000) throw new Error('timed out');
      if (!card && (await panel.$('.approval'))) {
        card = await panel.$eval('.approval', (e) => ({ title: e.querySelector('.approval-title')?.textContent, buttons: [...e.querySelectorAll('.approval-actions button')].map((b) => b.textContent.trim()) }));
        await onApproval(card);
      }
      if (await panel.$('.turn:last-child .activity.done, .turn:last-child .activity.failed, .turn:last-child .notice.error')) break;
      await sleep(300);
    }
    await sleep(300);
    return { card, answer: await panel.$eval('.turn:last-child', (e) => e.innerText.replace(/\s+/g, ' ')), clicked: await page.evaluate(() => window.__clicked ?? ''), formOpen: await page.evaluate(() => getComputedStyle(document.querySelector('.modal')).display !== 'none') };
  };
  const press = (label) => panel.evaluate((label) => [...document.querySelectorAll('.approval-actions button')].find((b) => b.textContent.trim() === label)?.click(), label);

  const a = await run('form save', () => press('Complete'));
  check('the card offers the form’s own buttons; picking “Complete” presses Complete, not Save', JSON.stringify(a.card?.buttons) === '["Complete","Save","Reset","Cancel"]' && a.clicked === 'complete', `${JSON.stringify(a.card)} · clicked=${a.clicked} · ${a.answer.slice(-160)}`);

  const b = await run('form save', () => press('Cancel'));
  check('Cancel in the chat presses the form’s Cancel too — the form closes, nothing saved', b.clicked === 'cancel' && !b.formOpen && /Cancelled — you said no/.test(b.answer), `clicked=${b.clicked} formOpen=${b.formOpen} · ${b.answer.slice(-160)}`);

  const c = await run('form save', () => page.evaluate(() => [...document.querySelectorAll('.foot button')].find((x) => x.textContent === 'Cancel').click()));
  const cardGone = !(await panel.$('.approval'));
  check('Cancel on the page takes the question away in the chat', c.clicked === 'cancel' && cardGone && /the form was closed on the page/.test(c.answer), `clicked=${c.clicked} cardGone=${cardGone} · ${c.answer.slice(-160)}`);

  const d = await run('form save', () => press('Save'));
  check('picking the button the agent meant (“Save”) presses it', d.clicked === 'dialog-save', `clicked=${d.clicked}`);
  const e = await run('form enter', () => press('Save'));
  const typed = await page.evaluate(() => document.getElementById('duein').value);
  check('Enter in a field asks with the form’s buttons too; picking “Save” types the text, then presses Save', JSON.stringify(e.card?.buttons) === '["Complete","Save","Reset","Cancel"]' && e.clicked === 'dialog-save' && typed === '2 weeks', `${JSON.stringify(e.card)} clicked=${e.clicked} typed=${typed} · ${e.answer.slice(-400)}`);
} catch (err) {
  console.error('E2E error:', err);
  results.push(false);
} finally {
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`${results.length - failed}/${results.length} checks passed`);
}
