// Fit-to-screen check: for every configuration page and size, does anything scroll (or overflow sideways)?
import puppeteer from 'puppeteer';
const EXT = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
const extId = new URL((await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'))).url()).host;
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)));
await page.goto(`chrome-extension://${extId}/options.html`);
await sleep(600);
// A full setup: 9 agents, 8 skills, a Kaggle connection, an Indici site with 9 entries, 15 tasks.
await page.evaluate(async () => {
  const tools = ['read_page', 'find_element', 'scroll', 'wait', 'click', 'click_text', 'type', 'clear', 'select_option', 'hover', 'open_menu', 'press_key', 'navigate', 'go_back', 'go_forward', 'list_tabs', 'open_tab', 'switch_tab', 'close_tab'];
  const names = ['Assistant', 'Reader', 'Medication agent', 'Diagnosis agent', 'Task agent', 'Recall agent', 'Appointment agent', 'CareFlow team', 'Indici agent'];
  const agents = names.map((n, i) => ({ id: i ? 'agent_' + i : 'agent-assistant', name: n, description: 'Does ' + n.toLowerCase() + ' work on any website — searching, filling forms, clicking through pages.', avatar: { icon: 'Sparkles', color: ['#10b981', '#0ea5e9', '#8b5cf6', '#f59e0b'][i % 4] }, instructions: '', providerId: null, model: '', temperature: 0.1, maxSteps: 25, confirmation: 'smart', toolIds: tools, skillIds: ['s1', 's2'], createdAt: 1, updatedAt: 1 }));
  const skills = Array.from({ length: 8 }, (_, i) => ({ id: 's' + i, name: 'Skill number ' + i, description: 'Use when doing thing ' + i, instructions: 'Do it well.', activation: i % 2 ? 'always' : 'on-demand', sites: [], createdAt: 1, updatedAt: 1 }));
  const k = (i, kind) => ({ id: 'k' + i, kind, title: 'Entry number ' + i, content: 'Some text about entry ' + i, enabled: true, createdAt: 1, updatedAt: 1 });
  const site = { id: 'site_t', name: 'indici training', description: '', color: '#0e7490', sites: ['pmstraining.vitonta.com'], enabled: true, providerId: null, model: '', agentIds: ['agent-assistant', 'agent_8'], skillIds: ['s3'], disabledSkillIds: [], customToolIds: [], disabledToolIds: [], neverClick: ['Pharmac'], knowledge: Array.from({ length: 9 }, (_, i) => k(i, ['rule', 'navigation', 'page', 'workflow'][i % 4])), createdAt: 1, updatedAt: 1 };
  const now = Date.now();
  const tasks = Array.from({ length: 15 }, (_, i) => ({ id: 't' + i, request: 'Goto patients and select patient number ' + i, agentId: 'agent-assistant', agentName: 'Assistant', url: 'https://x.test', site: 'x.test', title: 'X', status: ['done', 'failed', 'cancelled'][i % 3], startedAt: now - i * 60000, endedAt: now - i * 60000 + 9000, steps: [{ id: 'a' + i, label: 'Reading the page', status: 'done', tool: 'read_page', startedAt: now, durationMs: 300 }], result: 'Opened **patient ' + i + '**.' }));
  await chrome.storage.local.set({
    'wa.history': tasks,
    'wa.config': { version: 1, providers: [{ id: 'kaggle', name: 'Kaggle GPU', kind: 'openai', preset: 'kaggle', baseUrl: 'http://localhost:4610/vllm/v1', apiKey: 'k', defaultModel: 'qwen3.5:9b', createdAt: 1 }], agents, skills, customTools: [], sites: [site], settings: { defaultProviderId: 'kaggle', defaultAgentId: 'agent-assistant', knownToolIds: tools } },
  });
});
await page.reload();
await sleep(600);

const routes = ['agents', 'skills', 'tools', 'models', 'voice', 'sites', 'sites/site_t', 'general', 'appearance', 'behavior', 'permissions', 'privacy', 'advanced', 'activity'];
const tabs = ['Agents', 'Skills', 'Tools', 'Model', 'Settings', 'Preview'];
const sizes = (process.env.SIZES ?? '768x1024,1024x768,1366x768,1920x1080,2560x1440').split(',').map((s) => s.split('x').map(Number));
// Elements that scroll by design in fit mode: the big text boxes and the task reading pane.
const ALLOWED = /spec-json|site-preview|ant-input|activity-detail-pane|textarea/;
const check = () =>
  page.evaluate((allowedSrc) => {
    const allowed = new RegExp(allowedSrc);
    const se = document.scrollingElement;
    const scrollers = [...document.querySelectorAll('*')]
      .filter((el) => {
        const cs = getComputedStyle(el);
        return /auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1 && el.clientHeight > 0;
      })
      .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 2).join('.')}+${el.scrollHeight - el.clientHeight}`)
      .filter((d) => !allowed.test(d));
    return { pageOver: se.scrollHeight - innerHeight, hx: se.scrollWidth > innerWidth + 1, scrollers };
  }, ALLOWED.source);
let bad = 0;
for (const [w, h] of sizes) {
  await page.setViewport({ width: w, height: h });
  const out = [];
  for (const r of routes) {
    await page.goto(`chrome-extension://${extId}/options.html#/${r}`);
    await sleep(500);
    const variants = r === 'sites/site_t' ? ['Knowledge', ...tabs] : [null];
    for (const tab of variants) {
      if (tab) {
        await page.evaluate((t) => [...document.querySelectorAll('.ant-tabs-tab')].find((e) => e.textContent.startsWith(t))?.click(), tab);
        await sleep(350);
      }
      const m = await check();
      const name = tab ? `site:${tab}` : r;
      const problems = [m.pageOver > 1 ? `page+${m.pageOver}` : '', m.hx ? 'SIDEWAYS' : '', ...m.scrollers].filter(Boolean);
      if (problems.length) bad++;
      out.push(problems.length ? `${name}[${problems.join(' ')}]` : `${name}:ok`);
    }
  }
  console.log(`${w}x${h}  ${out.join('  ')}`);
}
console.log(bad ? `\n${bad} page/size combinations scroll or overflow` : '\nnothing scrolls or overflows');
await browser.close();
