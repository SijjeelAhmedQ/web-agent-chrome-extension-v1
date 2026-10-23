// A stopped task shows Resume (not Run again); Resume carries the task on from where it stopped.
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
  const sent = [];
  panel.on('request', (req) => {
    if (/localhost:4600\/v1\/chat/.test(req.url())) sent.push(JSON.parse(req.postData() ?? '{}'));
  });
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  await panel.evaluate(async (tools) => {
    const provider = { id: 'p', name: 'Mock', kind: 'openai', preset: 'custom', baseUrl: 'http://localhost:4600/v1', apiKey: '', defaultModel: 'mock-1', createdAt: 1 };
    const agent = { id: 'agent-assistant', name: 'Assistant', description: '', avatar: { icon: 'Sparkles', color: '#10b981' }, instructions: '', providerId: null, model: '', temperature: 0.1, maxSteps: 25, confirmation: 'smart', toolIds: tools, skillIds: [], createdAt: 1, updatedAt: 1 };
    await chrome.storage.local.set({ 'wa.config': { version: 1, providers: [provider], agents: [agent], skills: [], customTools: [], sites: [], settings: { defaultProviderId: 'p', defaultAgentId: 'agent-assistant', developerMode: true, expandActivity: true, knownToolIds: tools } } });
    await chrome.storage.session.remove('wa.chat');
  }, TOOLS);
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });
  await page.goto('http://localhost:4599/addtask.html');
  await page.bringToFront();
  await panel.reload();
  await panel.waitForSelector('#composer-input');
  await sleep(500);
  await panel.$eval('#composer-input', (el) => el.focus());
  await panel.keyboard.type('form save');
  await panel.keyboard.press('Enter');
  // At the approval card, stop the task.
  for (const t0 = Date.now(); !(await panel.$('.approval')); await sleep(300)) if (Date.now() - t0 > 90000) throw new Error('no card');
  await panel.$eval('.stop-btn', (b) => b.click());
  for (const t0 = Date.now(); !(await panel.$('.turn:last-child .notice.quiet')); await sleep(300)) if (Date.now() - t0 > 30000) throw new Error('not stopped');
  const actions = await panel.$$eval('.turn:last-child button', (bs) => bs.map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim()).filter(Boolean));
  check('a stopped task offers Resume, not Run again', actions.some((a) => a === 'Resume') && actions.some((a) => /Resume this task/.test(a)) && !actions.some((a) => a === 'Run again'), JSON.stringify(actions));

  const before = sent.length;
  await panel.evaluate(() => [...document.querySelectorAll('.turn:last-child .link-btn')].find((b) => b.textContent.trim() === 'Resume')?.click());
  for (const t0 = Date.now(); sent.length === before; await sleep(300)) if (Date.now() - t0 > 30000) throw new Error('no request after Resume');
  const ask = sent[before].messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';
  const remembered = sent[before].messages.filter((m) => m.role === 'assistant').map((m) => m.content ?? '').join('\n');
  check('Resume carries the same task on from where it stopped', /My reply to your question: “Resume — carry on from where you stopped\.”/.test(ask) && /Carry on with the task I gave you before \(“form save”\)/.test(ask), ask.slice(0, 300));
  check('what was done before the stop goes along', /Where I stopped|steps already done/.test(remembered) || /Reading the page/.test(remembered), remembered.slice(-300));
  const bubble = await panel.$eval('.turn:last-child .bubble', (e) => e.textContent);
  check('the new turn reads as a resume', /^Resume/.test(bubble ?? ''), bubble ?? '');
} catch (err) {
  console.error('E2E error:', err);
  results.push(false);
} finally {
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`${results.length - failed}/${results.length} checks passed`);
}
