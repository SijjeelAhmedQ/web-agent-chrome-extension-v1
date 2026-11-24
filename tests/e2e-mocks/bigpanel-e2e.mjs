// A panel opened on a page of more controls than are listed: its controls come first in the next read.
import puppeteer from 'puppeteer';
const EXT = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, x = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };
const browser = await puppeteer.launch({ headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
try {
  const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'));
  const worker = await sw.worker();
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });
  await page.goto('http://localhost:4599/bigpanel.html');
  await sleep(800);
  const snap = () => worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'http://localhost:4599/bigpanel.html' });
    if (!self.injected) { await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ['content.js'] }); self.injected = true; }
    const r = await chrome.tabs.sendMessage(tab.id, { channel: 'web-agent/v1', request: { kind: 'snapshot', mode: 'overview', maxElements: 250, maxTextChars: 2000 } }, { frameId: 0 });
    return r.data;
  });
  const names = (s) => s.elements.map((e) => e.name);
  const s1 = await snap();
  check('first read is cut', s1.omitted > 100, `${s1.elements.length} listed, ${s1.omitted} left out`);
  await page.evaluate(() => document.getElementById('tabInbox').click()); await sleep(300);
  const s2 = await snap();
  const n2 = names(s2);
  check('the opened Inbox panel is listed', ['Flagged', 'Lab', 'LFT result', 'CBC result'].every((n) => n2.includes(n)), n2.filter((n) => !n.startsWith('Consult')).join(', '));
  check('the chevron is listed', s2.elements.some((e) => /chevron|filters/i.test(e.name)), s2.elements.filter((e) => /icon/.test(e.name)).map((e) => e.name).join());
  check('what is left out is reported as still there', (s2.unlisted ?? []).length === s2.omitted);
  await page.evaluate(() => document.querySelector('.fa-chevron-down').click()); await sleep(300);
  const s3 = await snap();
  const n3 = names(s3);
  check('the opened filters are listed', s3.elements.some((e) => e.role === 'combobox' || e.tag === 'select') && n3.includes('Search'), n3.filter((n) => !n.startsWith('Consult')).join(', '));
  check('the panel stays listed', ['Flagged', 'LFT result'].every((n) => n3.includes(n)));
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
