// Team mode: a coordinator splits the request, three members fill three forms in their own tabs at once.
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

const browser = await puppeteer.launch({ headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1400,900'] });
try {
  const worker = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'));
  const extId = new URL(worker.url()).host;
  const setup = await browser.newPage();
  await setup.goto(`chrome-extension://${extId}/options.html`);
  await sleep(700);
  await setup.evaluate(async () => {
    const cur = (await chrome.storage.local.get('wa.config'))['wa.config'] ?? {};
    const mk = (id, name, description) => ({
      id, name, description, avatar: { icon: 'Bot', color: '#10b981' }, instructions: '', providerId: null, model: '', temperature: 0, maxSteps: 20,
      confirmation: 'smart', toolIds: ['read_page', 'find_element', 'click', 'type', 'select_option', 'scroll', 'wait'], skillIds: [], createdAt: 1, updatedAt: 1,
    });
    const members = [mk('m1', 'Med agent', 'Adds medications'), mk('m2', 'Dx agent', 'Adds diagnoses'), mk('m3', 'Task agent', 'Creates tasks')];
    const lead = { ...mk('lead', 'Clinic team', 'Splits record requests'), team: { memberIds: ['m1', 'm2', 'm3'], parallel: true, maxParallel: 3, tidyUp: true } };
    await chrome.storage.local.set({
      'wa.config': {
        ...cur,
        providers: [{ id: 'mock', name: 'Mock', kind: 'openai', preset: 'custom', baseUrl: 'http://localhost:4620/v1', apiKey: '', defaultModel: 'mock', createdAt: 1 }],
        agents: [...(cur.agents ?? []), ...members, lead],
        settings: { ...(cur.settings ?? {}), defaultProviderId: 'mock', defaultAgentId: 'lead', developerMode: false },
      },
    });
  });

  const panel = await browser.newPage();
  await panel.setViewport({ width: 400, height: 900 });
  panel.on('pageerror', (e) => console.log('[panel exception]', e.message));
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  await panel.waitForSelector('#composer-input');
  const site = await browser.newPage();
  await site.goto('http://localhost:4599/team.html');
  await site.evaluate(() => localStorage.clear());
  await site.bringToFront();
  await sleep(600);
  const tabsBefore = (await browser.pages()).length;

  // Count every approval card that ever appears, with its title.
  await panel.evaluate(() => {
    window.__approvals = [];
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) {
        if (!(n instanceof HTMLElement)) continue;
        const cards = n.matches('.approval') ? [n] : [...n.querySelectorAll('.approval')];
        for (const c of cards) window.__approvals.push(c.querySelector('.approval-title')?.textContent);
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  const t0 = Date.now();
  await panel.$eval('#composer-input', (el) => el.focus());
  await panel.keyboard.type('For Tom Baker add Metformin and Panadol 500 mg twice daily, add hypertension, and create a blood pressure monitoring task.');
  await panel.keyboard.press('Enter');

  // Members appear on the board; approve every Save as it comes.
  await panel.waitForFunction(() => document.querySelectorAll('.member').length === 3, { timeout: 20000, polling: 300 });
  check('coordinator split the request between 3 members', true);
  let tabsDuring = 0;
  let approvals = 0;
  let shot = false;
  for (;;) {
    const state = await panel.evaluate(() => ({
      done: !!document.querySelector('.turn > .agent-msg > .answer, .turn > .agent-msg > .notice'),
      approvals: [...document.querySelectorAll('.member .approval .ant-btn-primary')].length,
    }));
    tabsDuring = Math.max(tabsDuring, (await browser.pages()).length);
    if (state.done) break;
    if (state.approvals) {
      if (!shot && state.approvals >= 1) {
        await panel.bringToFront();
        await sleep(200);
        await panel.screenshot({ path: join(OUT, 'panel-team-working.png'), fullPage: true });
        shot = true;
      }
      approvals += state.approvals;
      await panel.$$eval('.member .approval .ant-btn-primary', (bs) => bs.forEach((b) => b.click()));
    }
    if (Date.now() - t0 > 180000) break;
    await sleep(400);
  }
  const elapsed = (Date.now() - t0) / 1000;
  check('each member worked in its own tab', tabsDuring >= tabsBefore + 3, `${tabsBefore} → ${tabsDuring} tabs`);
  const stats = await (await fetch('http://localhost:4620/stats')).json();
  check('model calls overlapped', stats.maxInFlight >= 3, `max ${stats.maxInFlight} at once, ${elapsed.toFixed(0)}s total`);

  // Data: each member saved in its own tab; localStorage is shared per origin.
  const data = await site.evaluate(() => ({
    meds: JSON.parse(localStorage.getItem('clinic.meds') || '[]'),
    dx: JSON.parse(localStorage.getItem('clinic.dx') || '[]'),
    tasks: JSON.parse(localStorage.getItem('clinic.tasks') || '[]'),
  }));
  check('medications saved', data.meds.length === 2 && data.meds.every((m) => m.dose === '500 mg' && m.freq === 'Twice daily'), JSON.stringify(data.meds));
  check('diagnosis saved', data.dx.length === 1 && data.dx[0].name === 'Hypertension', JSON.stringify(data.dx));
  check('task saved', data.tasks.length === 1 && data.tasks[0].title === 'Blood pressure monitoring', JSON.stringify(data.tasks));
  const seen = await panel.evaluate(() => window.__approvals);
  check('every Save asked for approval', seen.length === 4, JSON.stringify(seen));
  const answer = await panel.$eval('.turn > .agent-msg > .answer', (e) => e.textContent).catch(() => '');
  check('summary lists every member', /Med agent/.test(answer) && /Dx agent/.test(answer) && /Task agent/.test(answer), answer.slice(0, 90));
  await sleep(800);
  check('member tabs tidied up', (await browser.pages()).length === tabsBefore, `${(await browser.pages()).length} tabs`);
  await panel.bringToFront();
  await sleep(300);
  await panel.screenshot({ path: join(OUT, 'panel-team-done.png'), fullPage: true });
} catch (err) {
  console.error('E2E error:', err);
  results.push(false);
} finally {
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
}
