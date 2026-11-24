// The Web Agent side panel: only the conversation (or history list) scrolls; nothing overflows sideways.
import puppeteer from 'puppeteer';
const EXT = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
const extId = new URL((await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'))).url()).host;
const page = await browser.newPage();
await page.goto(`chrome-extension://${extId}/sidepanel.html`);
await sleep(500);
const now = Date.now();
const long = 'Averyveryveryveryveryverylongwordwithoutanyspacesthatcouldbreakthelayout '.repeat(3);
const steps = Array.from({ length: 14 }, (_, i) => ({ id: 's' + i, label: `Clicking “Button number ${i} with a fairly long accessible name”`, note: 'Opened a new page', status: 'done', tool: 'click', startedAt: now, durationMs: 400 }));
const task = (id, request, result) => ({ id, request, agentId: 'agent-assistant', agentName: 'Assistant', url: 'https://x.test', site: 'x.test', title: 'X', status: 'done', startedAt: now - 9000, endedAt: now, steps, result });
const T1 = task('t1', 'Find the cheapest laptop ' + long, ['| Laptop | RAM | Price | Notes |', '|---|---|---|---|', '| Aero 14 | 16 GB | $649 | ' + long + ' |', '', '```', 'x'.repeat(300), '```'].join('\n'));
const T2 = task('t2', 'Summarize', 'Here is a long answer. '.repeat(80));
const putChat = () => page.evaluate(async (t1, t2) => {
  await chrome.storage.session.set({ 'wa.chat': { turns: [{ id: 'a', request: t1.request, agentId: 'agent-assistant', task: t1, thinking: false, approval: null }, { id: 'b', request: t2.request, agentId: 'agent-assistant', task: t2, thinking: false, approval: null }], memory: [] } });
}, T1, T2);
await page.evaluate(async (t1, t2) => {
  const c = (await chrome.storage.local.get('wa.config'))['wa.config'] ?? { version: 1, agents: [], skills: [], customTools: [], settings: {} };
  await chrome.storage.local.set({ 'wa.config': { ...c, providers: [{ id: 'p', name: 'Mock', kind: 'openai', preset: 'custom', baseUrl: 'http://localhost:4600/v1', apiKey: '', defaultModel: 'mock-1', createdAt: 1 }], settings: { ...(c.settings ?? {}), defaultProviderId: 'p', expandActivity: true } } });
  await chrome.storage.session.set({ 'wa.chat': { turns: [{ id: 'a', request: t1.request, agentId: 'agent-assistant', task: t1, thinking: false, approval: null }, { id: 'b', request: t2.request, agentId: 'agent-assistant', task: t2, thinking: false, approval: null }], memory: [] } });
  await chrome.storage.local.set({ 'wa.history': [t1, t2] });
}, task('t1', 'Find the cheapest laptop ' + long, '| Laptop | RAM | Price | Notes |\n|---|---|---|---|\n| Aero 14 | 16 GB | $649 | ' + long + ' |\n\n```\n' + 'x'.repeat(300) + '\n```'), task('t2', 'Summarize', 'Here is a long answer. '.repeat(80)));
const sizes = [[360, 800], [390, 844], [430, 932], [768, 1024], [1024, 768], [1366, 768], [1920, 1080], [2560, 1440]];
let bad = 0;
for (const [w, h] of sizes) {
  await page.setViewport({ width: w, height: h });
  const res = [];
  await putChat();
  for (const view of ['chat', 'history', 'empty']) {
    if (view === 'empty') await page.evaluate(() => chrome.storage.session.remove('wa.chat'));
    await page.reload();
    await sleep(700);
    if (view === 'history') {
      const clicked = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /history|activity/i.test(x.getAttribute('aria-label') ?? '')); b?.click(); return b?.getAttribute('aria-label') ?? 'none'; });
      if (w === 360) console.log('history button:', clicked);
      await sleep(500);
    }
    const m = await page.evaluate(() => {
      const se = document.scrollingElement;
      const scrollers = [...document.querySelectorAll('*')].filter((el) => /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1 && el.clientHeight > 0).map((el) => el.className.split(' ')[0]);
      const wide = [...document.querySelectorAll('.panel *')].filter((el) => el.getBoundingClientRect().right > innerWidth + 1 && !el.closest('pre, .md table, .md-table-wrap, .composer textarea')).map((el) => el.className?.split?.(' ')[0] || el.tagName).slice(0, 4);
      const composer = document.querySelector('.composer')?.getBoundingClientRect();
      return { page: se.scrollHeight - innerHeight, hx: se.scrollWidth > innerWidth + 1, scrollers, wide, composerVisible: !!composer && composer.bottom <= innerHeight + 1 && composer.top >= 0 };
    });
    const problems = [m.page > 1 ? `page+${m.page}` : '', m.hx ? 'SIDEWAYS' : '', ...m.scrollers.filter((s) => !/^(chat|view-scroll)$/.test(s)).map((s) => `scroll:${s}`), ...m.wide.map((s) => `wide:${s}`), m.composerVisible ? '' : 'composer-hidden'].filter(Boolean);
    if (problems.length) bad++;
    res.push(`${view}:${problems.length ? problems.join(',') : 'ok'}${m.scrollers.length ? ` (scrolls: ${m.scrollers.join('/')})` : ''}`);
    if (view === 'empty') await page.evaluate(async () => {});
  }
  // put the chat back for the next size
  console.log(`${w}x${h}  ${res.join('  ')}`);
}
console.log(bad ? `${bad} problems` : 'side panel: only the conversation scrolls; nothing overflows');
await browser.close();
