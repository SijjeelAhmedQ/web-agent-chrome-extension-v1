// Expandable sections and paged lists: state survives collapsing, keyboard works, pages move, phones show everything.
import puppeteer from 'puppeteer';

const EXT = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
};
const browser = await puppeteer.launch({ headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
try {
  const extId = new URL((await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'))).url()).host;
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 768 });
  await page.goto(`chrome-extension://${extId}/options.html`);
  await sleep(500);
  await page.evaluate(async () => {
    const k = (i) => ({ id: 'k' + i, kind: 'rule', title: 'Rule number ' + i, content: 'Text ' + i, enabled: true, createdAt: 1, updatedAt: 1 });
    const site = { id: 'site_t', name: 'indici training', description: '', color: '#0e7490', sites: ['x.test'], enabled: true, providerId: null, model: '', agentIds: [], skillIds: [], disabledSkillIds: [], customToolIds: [], disabledToolIds: [], neverClick: [], knowledge: Array.from({ length: 14 }, (_, i) => k(i)), createdAt: 1, updatedAt: 1 };
    const c = (await chrome.storage.local.get('wa.config'))['wa.config'] ?? { version: 1, agents: [], skills: [], customTools: [], settings: {} };
    await chrome.storage.local.set({ 'wa.config': { ...c, sites: [site] } });
  });

  // 1) Typing in a section, collapsing it and opening it again keeps the text.
  await page.goto(`chrome-extension://${extId}/options.html#/sites/site_t`);
  await sleep(700);
  await page.evaluate(() => [...document.querySelectorAll('.ant-tabs-tab')].find((t) => t.textContent.startsWith('Preview')).click());
  await sleep(400);
  const toggles = () => page.$$eval('.acc-toggle', (bs) => bs.map((b) => `${b.querySelector('.acc-title').textContent}:${b.getAttribute('aria-expanded')}`));
  check('first section open, second closed (aria-expanded)', JSON.stringify(await toggles()) === JSON.stringify(['What the agent gets:true', 'Knowledge as text:false']), (await toggles()).join(' | '));
  await page.evaluate(() => [...document.querySelectorAll('.acc-toggle')].find((b) => b.textContent.includes('Knowledge as text')).click());
  await sleep(300);
  await page.$eval('textarea[aria-label="Knowledge base as text"]', (t) => t.focus());
  await page.keyboard.type('\n\n### Rule: Typed but not applied yet\nKeep me.');
  await page.evaluate(() => [...document.querySelectorAll('.acc-toggle')].find((b) => b.textContent.includes('What the agent gets')).click());
  await sleep(300);
  const hiddenNow = await page.$eval('textarea[aria-label="Knowledge base as text"]', (t) => t.closest('.acc-body').hidden);
  await page.evaluate(() => [...document.querySelectorAll('.acc-toggle')].find((b) => b.textContent.includes('Knowledge as text')).click());
  await sleep(300);
  const kept = await page.$eval('textarea[aria-label="Knowledge base as text"]', (t) => t.value);
  check('collapsing a section keeps unsaved text', hiddenNow && /Typed but not applied yet/.test(kept));

  // 2) Keyboard: arrows move between section headers; Enter toggles.
  await page.$eval('.acc-toggle', (b) => b.focus());
  await page.keyboard.press('ArrowDown');
  const focused = await page.evaluate(() => document.activeElement?.textContent ?? '');
  await page.keyboard.press('Enter');
  await sleep(250);
  const afterEnter = await toggles();
  check('arrow keys move between headers, Enter toggles', /Knowledge as text/.test(focused) && afterEnter[1].endsWith(':false'), afterEnter.join(' | '));

  // 3) Paged list: next/previous and the counter.
  await page.evaluate(() => [...document.querySelectorAll('.ant-tabs-tab')].find((t) => t.textContent.startsWith('Knowledge base')).click());
  await sleep(500);
  const info1 = await page.$eval('.pager-info', (e) => e.textContent);
  const firstTitle1 = await page.$eval('.list-row .list-title', (e) => e.textContent);
  await page.$eval('.pager button[aria-label="Next page"]', (b) => b.click());
  await sleep(250);
  const info2 = await page.$eval('.pager-info', (e) => e.textContent);
  const firstTitle2 = await page.$eval('.list-row .list-title', (e) => e.textContent);
  await page.$eval('.pager button[aria-label="Previous page"]', (b) => b.click());
  await sleep(250);
  check('pager moves through every entry', /^1–\d+ of 14$/.test(info1) && info2 !== info1 && firstTitle1 !== firstTitle2 && (await page.$eval('.pager-info', (e) => e.textContent)) === info1, `${info1} → ${info2}`);
  const prevDisabled = await page.$eval('.pager button[aria-label="Previous page"]', (b) => b.disabled);
  check('Previous is disabled on the first page', prevDisabled);

  // 4) A new entry jumps to the page it lands on.
  await page.evaluate(async () => {
    const { 'wa.config': c } = await chrome.storage.local.get('wa.config');
    c.sites[0].knowledge.push({ id: 'knew', kind: 'rule', title: 'Brand new entry', content: 'x', enabled: true, createdAt: 2, updatedAt: 2 });
    await chrome.storage.local.set({ 'wa.config': c });
  });
  await sleep(600);
  const titles = await page.$$eval('.list-row .list-title', (els) => els.map((e) => e.textContent));
  check('a new entry is shown on its page', titles.includes('Brand new entry'), titles.join(' | '));

  // 5) Phone: no paging, every entry in the page.
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await sleep(600);
  const rows = await page.$$eval('.list-row', (els) => els.length);
  const pager = await page.$('.pager');
  check('on a phone every entry is listed (page scrolls)', rows === 15 && !pager, `${rows} rows`);
} catch (err) {
  console.error('E2E error:', err);
  results.push(false);
} finally {
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
}
