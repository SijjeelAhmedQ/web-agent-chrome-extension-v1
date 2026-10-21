// Real model on the Kaggle notebook (KAGGLE_URL / KAGGLE_KEY from the environment — never saved):
// an Indici-like site (hover menu, a 240-control Patient Search page, stacked pop-ups on the consult)
// with the user's own knowledge base.
//   SCENARIO=select  — on the Dashboard, fresh chat: "goto patients and select arya stark"
//   SCENARIO=stale   — on the Dashboard, the chat remembers an earlier open consult
import puppeteer from 'puppeteer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const EXT = process.argv[2];
const SCENARIO = process.env.SCENARIO ?? 'select';
const OUT = join(import.meta.dirname, 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!(process.env.KAGGLE_URL && process.env.KAGGLE_KEY) && !process.env.OPENROUTER_KEY) throw new Error('set KAGGLE_URL + KAGGLE_KEY, or OPENROUTER_KEY');

// The knowledge base as the user has it, parsed like “Knowledge as text”.
const KINDS = { Rule: 'rule', Navigation: 'navigation', Page: 'page', Workflow: 'workflow' };
const knowledge = readFileSync(join(import.meta.dirname, process.env.KNOWLEDGE ?? 'indici-knowledge.txt'), 'utf8').replaceAll(String.fromCharCode(13), '')
  .split(/^### /m)
  .filter((b) => b.trim())
  .map((block, i) => {
    const [head, ...rest] = block.split('\n');
    const [, kind, title] = head.match(/^(\w+): (.*)$/);
    let body = rest.join('\n').trim();
    let trigger;
    const t = body.match(/^For requests like: “(.*)”\n/);
    if (t) {
      trigger = t[1];
      body = body.slice(t[0].length);
    }
    return { id: `kb${i}`, kind: KINDS[kind], title, content: body, ...(trigger ? { trigger } : {}), enabled: true, createdAt: 1, updatedAt: 1 };
  });

const browser = await puppeteer.launch({ headless: true, protocolTimeout: 1800000, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1300,900'] });
try {
  const extId = new URL((await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'))).url()).host;
  const panel = await browser.newPage();
  await panel.setViewport({ width: 420, height: 900 });
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  // Real models only: the Kaggle notebook, or OpenRouter (keys from the environment, never saved).
  const provider = process.env.OPENROUTER_KEY
    ? { id: 'p', name: 'OpenRouter', kind: 'openai', preset: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: process.env.OPENROUTER_KEY, timeoutMs: 300000, defaultModel: process.env.OPENROUTER_MODEL ?? 'deepseek/deepseek-v4-flash', createdAt: 1 }
    : { id: 'p', name: 'Kaggle GPU', kind: 'openai', preset: 'kaggle', baseUrl: `${process.env.KAGGLE_URL}/vllm/v1`, apiKey: process.env.KAGGLE_KEY, keyHeader: 'X-CareFlow-Key', timeoutMs: 600000, contextWindow: 16384, defaultModel: process.env.KAGGLE_MODEL ?? 'qwen3.5:9b', createdAt: 1 };
  await panel.evaluate(
    async (provider, knowledge, scenario) => {
      const tools = ['read_page', 'find_element', 'scroll', 'wait', 'click', 'click_text', 'type', 'clear', 'select_option', 'hover', 'open_menu', 'press_key', 'navigate', 'go_back', 'go_forward', 'list_tabs', 'open_tab', 'switch_tab', 'close_tab'];
      const agent = { id: 'agent-indici', name: 'indici agent', description: 'Works in the Indici PMS.', avatar: { icon: 'Stethoscope', color: '#0e7490' }, instructions: '', providerId: 'p', model: '', temperature: 0.2, maxSteps: 40, confirmation: 'smart', toolIds: tools, skillIds: [], createdAt: 1, updatedAt: 1 };
      const site = { id: 'site_indici', name: 'indici training', description: '', color: '#0e7490', sites: ['localhost:4599'], enabled: true, providerId: null, model: '', agentIds: ['agent-indici'], skillIds: [], disabledSkillIds: [], customToolIds: [], disabledToolIds: [], neverClick: [], knowledge, createdAt: 1, updatedAt: 1 };
      await chrome.storage.local.set({ 'wa.config': { version: 1, providers: [provider], agents: [agent], skills: [], customTools: [], sites: [site], settings: { defaultProviderId: 'p', defaultAgentId: 'agent-indici', developerMode: true, expandActivity: true, knownToolIds: tools } } });
      // “stale”: the chat remembers a consult that was open earlier — the tab is on the Dashboard now.
      const memory =
        scenario === 'stale'
          ? [
              { role: 'user', content: 'goto patients and select arya stark' },
              { role: 'assistant', content: "**Arya STARK**'s consult is open.\n\nI entered **\"follow\"** as the reason and saved it, then closed the **Patient Alerts** pop-up.\n- **Name:** Arya STARK\n- **DOB:** 03/12/2015\n- **NHI:** ZAA3490" },
            ]
          : [];
      await chrome.storage.session.set({ 'wa.chat': { turns: [], memory } });
    },
    provider,
    knowledge,
    SCENARIO,
  );
  const site = await browser.newPage();
  await site.setViewport({ width: 1300, height: 800 });
  await site.goto(process.env.START_URL ?? 'http://localhost:4599/indici-dash.html');
  await site.bringToFront();
  await panel.reload();
  await panel.waitForSelector('#composer-input');
  await sleep(800);

  const request = process.env.REQUEST ?? (SCENARIO === 'stale' ? 'gotot patients and select arya stark' : 'goto patients and select arya stark');
  console.log(`[${SCENARIO}] ${request}`);
  await panel.$eval('#composer-input', (el) => el.focus());
  await panel.keyboard.type(request);
  await panel.keyboard.press('Enter');
  const t0 = Date.now();
  for (;;) {
    if (Date.now() - t0 > 25 * 60_000) throw new Error('timed out');
    if (await panel.$('.approval')) {
      const title = await panel.$eval('.approval-title', (e) => e.textContent);
      console.log(`  approval: ${title} → approved`);
      await panel.$eval('.approval .ant-btn-primary', (b) => b.click());
    }
    if (await panel.$('.turn:last-child .activity.done, .turn:last-child .activity.failed, .turn:last-child .notice.error')) break;
    await sleep(1000);
  }
  await sleep(500);
  const turns = [request, ...(process.env.REQUEST2 ? [process.env.REQUEST2] : [])];
  for (const extra of turns.slice(1)) {
    console.log(`--- turn 1 ---
${await panel.$eval('.turn:last-child', (e) => e.innerText)}
--- reply: ${extra}`);
    const before = await panel.$$eval('.turn', (x) => x.length);
    await panel.$eval('#composer-input', (el) => el.focus());
    await panel.keyboard.type(extra);
    await panel.keyboard.press('Enter');
    const t1 = Date.now();
    for (;;) {
      if (Date.now() - t1 > 25 * 60_000) throw new Error('timed out');
      if (await panel.$('.approval')) {
        console.log(`  approval: ${await panel.$eval('.approval-title', (e) => e.textContent)} → approved`);
        await panel.$eval('.approval .ant-btn-primary', (b) => b.click());
      }
      if (await panel.$$eval('.turn', (x, n) => x.length > n && !!x.at(-1).querySelector('.activity.done, .activity.failed, .notice.error'), before)) break;
      await sleep(1000);
    }
    await sleep(500);
  }
  const text = await panel.$eval('.turn:last-child', (e) => e.innerText);
  console.log(`--- ${Math.round((Date.now() - t0) / 1000)}s ---\n${text}\n---`);
  const pages = await browser.pages();
  const consult = pages.find((p) => p.url().includes('/stack.html'));
  const state = consult ? await consult.evaluate(() => ['alerts', 'reason'].map((i) => `${i}:${getComputedStyle(document.getElementById(i)).display !== 'none' ? 'showing' : 'closed'}`).join(' ')) : 'no consult tab';
  const search = pages.find((p) => p.url().includes('/indici-search.html'));
  const typed = search ? await search.$eval('#pn', (e) => e.value) : '';
  console.log(`RESULT consult=${state} · typed="${typed}"`);
  const inboxPage = pages.find((p) => p.url().includes('/inbox.html'));
  if (inboxPage) console.log('INBOX', JSON.stringify(await inboxPage.evaluate(() => window.__recs.map((r) => ({ subject: r.subject, comments: r.comments, filed: r.filed })))));
  const rtPage = pages.find((p) => p.url().includes('/consult-rt.html'));
  if (rtPage) console.log('SAVED', JSON.stringify(await rtPage.evaluate(() => window.__saved)));
  await panel.screenshot({ path: join(OUT, `kaggle-${SCENARIO}.png`), fullPage: true });
} finally {
  await browser.close();
}
