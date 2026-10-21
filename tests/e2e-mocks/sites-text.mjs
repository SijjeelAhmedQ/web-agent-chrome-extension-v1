// Site → Preview: copy the preview, paste text, edit the knowledge base as text and apply it.
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
      const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.trim() === text || e.textContent.trim().startsWith(text));
      if (!el) return false;
      el.click();
      return true;
    },
    sel,
    text,
  );

const browser = await puppeteer.launch({ headless: true, protocolTimeout: 900000, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
try {
  const extId = new URL((await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'))).url()).host;
  await browser.defaultBrowserContext().overridePermissions(`chrome-extension://${extId}`, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  const opt = await browser.newPage();
  await opt.setViewport({ width: 1280, height: 1100 });
  await opt.goto(`chrome-extension://${extId}/options.html`);
  await sleep(600);
  await opt.evaluate(async () => {
    const k = (id, kind, title, content, extra = {}) => ({ id, kind, title, content, enabled: true, createdAt: 1, updatedAt: 1, ...extra });
    const site = {
      id: 'site_t', name: 'indici training', description: '', color: '#0e7490', sites: ['localhost:4599'], enabled: true, providerId: null, model: '', agentIds: [], skillIds: [], disabledSkillIds: [], customToolIds: [], disabledToolIds: [], neverClick: [],
      knowledge: [k('k1', 'rule', 'Open a patient by clicking the name', 'Click the name, never an icon.'), k('k2', 'navigation', 'Top menus open on hover', 'Use open_menu.')],
      createdAt: 1, updatedAt: 1,
    };
    const { 'wa.config': c } = await chrome.storage.local.get('wa.config');
    await chrome.storage.local.set({ 'wa.config': { ...(c ?? { version: 1, providers: [], agents: [], skills: [], customTools: [], settings: {} }), sites: [site] } });
  });
  await opt.goto(`chrome-extension://${extId}/options.html#/sites/site_t`);
  await sleep(900);
  await clickText(opt, '.ant-tabs-tab', 'Preview');
  await sleep(500);

  // 1) Copy the preview.
  await opt.evaluate(() => [...document.querySelectorAll('.acc-panel.open .acc-actions button')].find((b) => b.textContent.trim() === 'Copy').click());
  await sleep(300);
  const copied = await opt.evaluate(() => navigator.clipboard.readText());
  check('Copy puts the preview on the clipboard', /### Rule: Open a patient by clicking the name/.test(copied) && /## What the user has taught you/.test(copied), copied.slice(0, 60));

  // 2) The text box holds the whole knowledge base (in the second section — open it).
  await clickText(opt, '.acc-toggle', 'Knowledge as text');
  await sleep(400);
  const box = 'textarea[aria-label="Knowledge base as text"]';
  const start = await opt.$eval(box, (t) => t.value);
  check('the text box holds every entry', /### Rule: Open a patient/.test(start) && /### Navigation: Top menus open on hover/.test(start));

  // 3) Edit by typing: change a rule, add a workflow and a never-click list.
  await opt.$eval(box, (t) => t.focus());
  await opt.$eval(box, (t) => t.setSelectionRange(t.value.length, t.value.length));
  await opt.keyboard.type('\n\n### Workflow: Add a medication\nFor requests like: "add medication X"\n1. Click Medications\n2. Fill Take\n\n### Rule: Buttons you never click here\nThe user clicks these themselves: "Pharmac".');
  await sleep(300);
  const summary = await opt.evaluate(() => [...document.querySelectorAll('.preview-meta')].at(-1).innerText);
  check('it shows what it found as you type', /1 workflow/.test(summary) && /Never clicks: Pharmac/.test(summary) && /1 new/.test(summary), summary.replace(/\n/g, ' | '));

  // 4) Paste from the clipboard appends.
  await opt.evaluate(() => navigator.clipboard.writeText('### Page: Medication form\n- Take: number of tablets'));
  await clickText(opt, '.acc-actions button', 'Paste');
  await sleep(400);
  const afterPaste = await opt.$eval(box, (t) => t.value);
  check('Paste adds the clipboard text', afterPaste.trimEnd().endsWith('- Take: number of tablets'));
  await opt.screenshot({ path: join(OUT, 'sites-text.png'), fullPage: true });

  // 5) Apply.
  await clickText(opt, '.acc-actions button', 'Apply');
  await sleep(400);
  const modal = await opt.$eval('.ant-modal', (m) => m.innerText);
  check('Apply explains what will change', /2 new entries and 0 changed/.test(modal), modal.replace(/\n/g, ' | '));
  await opt.$eval('.ant-modal .ant-btn-primary', (b) => b.click());
  await sleep(500);
  const saved = await opt.evaluate(async () => (await chrome.storage.local.get('wa.config'))['wa.config'].sites[0]);
  check('entries created from the text', saved.knowledge.length === 4 && saved.knowledge.some((k) => k.kind === 'workflow' && k.trigger === 'add medication X' && /Fill Take/.test(k.content)) && saved.knowledge.some((k) => k.kind === 'page' && k.title === 'Medication form'), saved.knowledge.map((k) => `${k.kind}:${k.title}`).join(', '));
  check('never-click list set from the text', JSON.stringify(saved.neverClick) === '["Pharmac"]');
  await clickText(opt, '.ant-tabs-tab', 'Knowledge base (4)');
  await sleep(400);
  const rows = await opt.$$eval('.list-row .list-title', (els) => els.map((e) => e.textContent));
  check('the Knowledge base tab lists them', rows.includes('Add a medication') && rows.includes('Medication form'), rows.join(' | '));
} catch (err) {
  console.error('E2E error:', err);
  results.push(false);
} finally {
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
}
