// Real model (local Ollama) + the CareFlow team template, added through the UI, on the CareFlow dev server.
import puppeteer from 'puppeteer';
import { join } from 'node:path';

const EXT = process.argv[2];
const TASK = process.argv[3];
const BUDGET = Number(process.env.BUDGET_MS ?? 1500000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1400,900'] });
try {
  const worker = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'));
  const extId = new URL(worker.url()).host;
  const setup = await browser.newPage();
  await setup.setViewport({ width: 1280, height: 900 });
  await setup.goto(`chrome-extension://${extId}/options.html#/agents`);
  await sleep(800);
  await setup.evaluate(async () => {
    const cur = (await chrome.storage.local.get('wa.config'))['wa.config'] ?? {};
    await chrome.storage.local.set({
      'wa.config': {
        ...cur,
        providers: [{ id: 'ollama', name: 'Ollama', kind: 'ollama', preset: 'ollama', baseUrl: 'http://localhost:11434', apiKey: '', defaultModel: 'qwen3.5:4b', skipThinking: true, contextWindow: 12288, createdAt: 1 }],
        settings: { ...(cur.settings ?? {}), defaultProviderId: 'ollama', developerMode: true },
      },
    });
  });
  await setup.reload();
  await sleep(800);
  // Agents → New agent → CareFlow team (the template, through the real UI).
  await setup.$$eval('button', (bs) => bs.find((b) => b.textContent?.includes('New agent'))?.click());
  await sleep(500);
  await setup.$$eval('.ant-dropdown-menu-item', (items) => items.find((i) => i.textContent?.includes('CareFlow team'))?.click());
  await sleep(800);
  const cfg = await setup.evaluate(async () => (await chrome.storage.local.get('wa.config'))['wa.config']);
  const lead = cfg.agents.find((a) => a.team);
  console.log('template agents:', cfg.agents.map((a) => a.name).join(', '), '| team members:', lead?.team.memberIds.length, '| skill:', cfg.skills.find((s) => s.name === 'CareFlow PMS')?.sites);
  await setup.screenshot({ path: join(import.meta.dirname, 'shots', 'options-careflow-team.png') });
  // Local Ollama answers one request at a time: two members at once is plenty here.
  await setup.evaluate(async () => {
    const c = (await chrome.storage.local.get('wa.config'))['wa.config'];
    const team = c.agents.find((a) => a.team);
    team.team.maxParallel = 2;
    c.settings.defaultAgentId = team.id;
    await chrome.storage.local.set({ 'wa.config': c });
  });

  const panel = await browser.newPage();
  await panel.setViewport({ width: 400, height: 900 });
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  await panel.waitForSelector('#composer-input');
  const site = await browser.newPage();
  await site.setViewport({ width: 1280, height: 860 });
  await site.goto('http://localhost:5173/', { waitUntil: 'networkidle2' });
  await site.evaluate(() => localStorage.setItem('careflow.ai.config', JSON.stringify({ llm: { apiUrl: 'http://127.0.0.1:9' } })));
  await site.reload({ waitUntil: 'networkidle2' });
  await site.bringToFront();
  await sleep(800);
  const before = await site.evaluate(() => ({ dx: JSON.parse(localStorage.getItem('careflow.diagnoses') || 'null')?.length ?? null, tasks: JSON.parse(localStorage.getItem('careflow.tasks') || 'null')?.length ?? null }));

  await panel.$eval('#composer-input', (el) => el.focus());
  await panel.keyboard.type(TASK);
  await panel.keyboard.press('Enter');
  const t0 = Date.now();
  const approved = [];
  for (;;) {
    const s = await panel.evaluate(() => ({
      done: !!document.querySelector('.turn > .agent-msg > .answer, .turn > .agent-msg > .notice'),
      titles: [...document.querySelectorAll('.approval .approval-title')].map((e) => e.textContent),
    }));
    if (s.done) break;
    if (s.titles.length) {
      approved.push(...s.titles);
      await panel.$$eval('.approval .ant-btn-primary', (bs) => bs.forEach((b) => b.click()));
    }
    if (Date.now() - t0 > BUDGET) {
      console.log('budget reached — stopping');
      await panel.$eval('.stop-btn', (b) => b.click()).catch(() => {});
      await sleep(2000);
      break;
    }
    await sleep(1000);
  }
  console.log(`took ${Math.round((Date.now() - t0) / 1000)}s; approved: ${approved.join(' | ')}`);
  const report = await panel.evaluate(() =>
    [...document.querySelectorAll('.member')].map((m) => ({
      agent: m.querySelector('.member-name')?.textContent,
      task: m.querySelector('.member-task')?.textContent,
      steps: [...m.querySelectorAll('.step-label')].map((s) => s.textContent),
      result: m.querySelector('.member-result')?.textContent,
    })),
  );
  for (const r of report) console.log(`\n[${r.agent}] ${r.task}\n  steps: ${r.steps.join(' → ')}\n  result: ${r.result}`);
  console.log('\nanswer:', await panel.$eval('.turn > .agent-msg > .answer, .turn > .agent-msg > .notice', (e) => e.textContent).catch(() => '(none)'));
  const after = await site.evaluate(() => {
    const dx = JSON.parse(localStorage.getItem('careflow.diagnoses') || '[]');
    const tasks = JSON.parse(localStorage.getItem('careflow.tasks') || '[]');
    return { dx: dx.length, tasks: tasks.length, newDx: dx[0], newTask: tasks[0] };
  });
  console.log('\nbefore:', JSON.stringify(before), '\nafter:', JSON.stringify({ dx: after.dx, tasks: after.tasks }));
  console.log('newest diagnosis:', JSON.stringify(after.newDx)?.slice(0, 300));
  console.log('newest task:', JSON.stringify(after.newTask)?.slice(0, 300));
  await panel.bringToFront();
  await sleep(300);
  await panel.screenshot({ path: join(import.meta.dirname, 'shots', 'careflow-team.png'), fullPage: true });
} catch (err) {
  console.error('error', err);
} finally {
  await browser.close();
}
