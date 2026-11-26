// Phase 3 — does the agent work on small screens and on pages that don't fit them? Runs the same tasks with the
// site's tab shown at a phone, tablet or laptop size (Chrome's device emulation, kept on for the whole task), and
// checks the result on the page itself — not only what the agent says. Results go to screen-bench-results.jsonl.
//
// Setup as for token-bench.mjs (Chrome with --remote-debugging-port=9222, the extension, signed in, side panel open).
// Then: node scripts/screen-bench.mjs <label> <phone|tablet|laptop|desktop|WxH> [task numbers, e.g. 1,3] [site]
//   site: a part of the tab's address to find it by (default octanschiro-dev-app); START overrides the start page.
import { appendFileSync } from 'node:fs';

const [, , label = 'run', sizeArg = 'phone', only = '', siteMatch = 'octanschiro-dev-app'] = process.argv;
const SIZES = { phone: [375, 667], tablet: [768, 1024], laptop: [1366, 768], desktop: [1920, 1080] };
const [width, height] = SIZES[sizeArg] ?? sizeArg.split('x').map(Number);
const START = process.env.START ?? 'https://octanschiro-dev-app.vitonta.com/';

// Each task, and how to tell from the page (and the answer) that it was done right.
const OCTANS = [
  { task: 'Open practice members', check: { url: /\/patients/ } },
  { task: 'Find practice member talha asghar and open their profile', check: { answer: /three|3 (members|rows|matches|practice members)|which one/i } },
  { task: 'Open Stations and tell me how many stations are in Steiner Wing', check: { answer: /\b19\b/, url: /mentor-dashboard\/layout/ } },
  {
    task: 'Open the Add practice member form and fill First Name "Token" and Last Name "Bench". Do not save it.',
    check: { fields: { 'First Name': 'Token', 'Last Name': 'Bench' } },
  },
  {
    task: 'Open the Add practice member form and fill First Name "Token", Last Name "Bench", Mobile number "211234567", Email Address "token.bench@example.com" and City "Auckland". Do not save it.',
    check: { fields: { 'First Name': 'Token', 'Last Name': 'Bench', 'Mobile number': '211234567', 'Email Address': 'token.bench@example.com', City: 'Auckland' } },
  },
];
// TASKS (JSON): [{ task, check: { answer?, url?, status? (regex text; status = #status on the test page), fields? } }]
const asRe = (c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, typeof v === 'string' ? new RegExp(v, 'i') : v]));
const TASKS = process.env.TASKS ? JSON.parse(process.env.TASKS).map((t) => ({ ...t, check: asRe(t.check) })) : OCTANS;

const list = async () => (await fetch('http://127.0.0.1:9222/json/list')).json();
async function session(match) {
  const t = (await list()).find((x) => x.type === 'page' && x.url.includes(match));
  if (!t) throw new Error('no target ' + match);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let n = 0;
  const call = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++n;
      const on = (m) => {
        const d = JSON.parse(m.data);
        if (d.id !== id) return;
        ws.removeEventListener('message', on);
        resolve(d.result);
      };
      ws.addEventListener('message', on);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const ev = async (expression) => (await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }))?.result?.value;
  return { ws, call, ev };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The values a form shows now, by its labels (the pop-up in front, or the page).
const FIELDS = `(() => {
  const root = document.querySelector('[role=dialog][aria-modal=true]') ?? document;
  const out = {};
  for (const el of root.querySelectorAll('input:not([type=hidden]),textarea')) {
    const id = el.id && root.querySelector('label[for="' + CSS.escape(el.id) + '"]');
    const item = el.closest('.ant-form-item,[class*=InputWrapper-root],.field,label');
    const lab = (id?.innerText || item?.querySelector('label')?.innerText || el.getAttribute('aria-label') || el.placeholder || '').replace(/[*:]/g, '').trim();
    if (lab && !(lab in out)) out[lab] = el.value;
  }
  return out;
})()`;

const rows = [];
for (const [i, { task, check }] of TASKS.entries()) {
  if (only && !only.split(',').includes(String(i + 1))) continue;
  // The same start, and the screen size — kept by this session for the whole task.
  const site = await session(siteMatch);
  await site.call('Page.enable');
  // MOBILE=0: a narrow desktop window (what the extension really meets: a small window, or the side panel taking room)
  // — the page is laid out at that width and scrolls sideways, not zoomed out to fit as a phone does.
  const mobile = process.env.MOBILE !== '0' && width < 800;
  await site.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height });
  await site.call('Emulation.setTouchEmulationEnabled', { enabled: mobile });
  await site.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), 1`);
  await site.call('Page.navigate', { url: START });
  await sleep(1500);
  await site.call('Page.handleJavaScriptDialog', { accept: true }).catch(() => undefined);
  await sleep(4000);

  const panel = await session('sidepanel.html');
  await panel.ev(`(async () => { [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.innerText).trim() === 'New chat')?.click(); await new Promise((r) => setTimeout(r, 800)); })()`);
  const t0 = Date.now();
  await panel.ev(`(async () => {
    const box = document.querySelector('textarea');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    box.focus(); set.call(box, ${JSON.stringify(task)}); box.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Send' || b.innerText.trim() === 'Send').click();
  })()`);
  let rec = null;
  for (let w = 0; w < 100 && !rec; w++) {
    await sleep(3000);
    rec = await panel.ev(`chrome.storage.local.get('wa.history').then((s) => { const t = (s['wa.history'] || []).find((x) => x.request === ${JSON.stringify(task)} && x.startedAt >= ${t0 - 2000} && x.endedAt); return t ? JSON.parse(JSON.stringify(t)) : null; })`);
  }
  panel.ws.close();

  // What the page shows now, at this size.
  const url = await site.ev('location.href');
  const fields = check.fields ? await site.ev(FIELDS) : {};
  const status = check.status ? await site.ev("document.getElementById('status')?.textContent ?? ''") : '';
  const width_ = await site.ev('innerWidth');
  site.ws.close();

  const answer = rec?.result || rec?.error || '';
  const failed = [];
  if (!rec) failed.push('timed out');
  if (check.url && !check.url.test(url ?? '')) failed.push(`ended on ${url}`);
  if (check.answer && !check.answer.test(answer)) failed.push('answer wrong');
  if (check.status && !check.status.test(status ?? '')) failed.push(`page says ${JSON.stringify(status)}`);
  for (const [k, v] of Object.entries(check.fields ?? {})) {
    const got = Object.entries(fields ?? {}).find(([lab]) => lab.toLowerCase().startsWith(k.toLowerCase()))?.[1];
    if (got !== v) failed.push(`${k} = ${JSON.stringify(got)}`);
  }
  const calls = rec?.calls ?? [];
  const sum = (f) => calls.reduce((n, c) => n + (f(c) ?? 0), 0);
  const row = {
    task: `T${i + 1}`,
    size: `${width}x${height}`,
    shownWidth: width_,
    ok: !failed.length,
    failed,
    status: rec?.status,
    calls: calls.length,
    tokensIn: sum((c) => c.inputTokens),
    cost: +sum((c) => c.cost).toFixed(5),
    secs: rec ? Math.round(((rec.endedAt ?? 0) - rec.startedAt) / 1000) : null,
    steps: (rec?.steps ?? []).map((s) => `${s.label}${s.note ? ` — ${s.note}` : ''}${s.status === 'failed' ? ' [failed]' : ''}`),
    answer: answer.replace(/\s+/g, ' ').slice(0, 200),
  };
  rows.push(row);
  console.log(JSON.stringify({ ...row, steps: row.steps.length }));
}
const passed = rows.filter((r) => r.ok).length;
const total = { passed: `${passed}/${rows.length}`, calls: rows.reduce((n, r) => n + r.calls, 0), cost: +rows.reduce((n, r) => n + r.cost, 0).toFixed(5) };
console.log('TOTAL', JSON.stringify(total));
appendFileSync('screen-bench-results.jsonl', JSON.stringify({ label, size: `${width}x${height}`, at: new Date().toISOString(), rows, total }) + '\n');
process.exit(0);
