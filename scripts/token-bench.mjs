// Token benchmark — runs the same tasks on OctansCare dev, each from the dashboard in a new chat, and prints what
// each cost (calls, tokens in / cached / out, dollars, and what each prompt was made of). Results are appended to
// token-bench-results.jsonl. See docs/TOKENS.md.
//
// Setup (once): start Chrome with its debugging port and a profile of its own, load the extension (dist/) there,
// set the model, sign in to OctansCare, and open the side panel on its tab:
//   chrome.exe --user-data-dir=<a folder> --remote-debugging-port=9222
// Then: node scripts/token-bench.mjs <label> [task numbers, e.g. 1,3]
import { appendFileSync } from 'node:fs';

const [, , label = 'run', only = ''] = process.argv;
const START = 'https://octanschiro-dev-app.vitonta.com/';
const TASKS = [
  'Open practice members',
  'Find practice member talha asghar and open their profile',
  'Open Stations and tell me how many stations are in Steiner Wing',
  'Open the Add practice member form and fill First Name "Token" and Last Name "Bench". Do not save it.',
  // A long one (item 10): several pages, one after another, and an answer from all of them.
  'Open Tags and tell me how many tags are active, then open Stations and tell me how many stations are in Dobson Wing, then open Messages and tell me how many conversations are unread, then open Practice members and tell me how many members have no NHI.',
  // A big form (item 11): seven fields — typed and chosen — of one pop-up, not saved.
  'Open the Add practice member form and fill First Name "Token", Last Name "Bench", Gender "Male", Mobile number "211234567", Email Address "token.bench@example.com", Preferred contact "Email" and City "Auckland". Do not save it.',
];

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

const rows = [];
for (const [i, task] of TASKS.entries()) {
  if (only && !only.split(',').includes(String(i + 1))) continue;
  // The same start: the dashboard, nothing open.
  const site = await session('octanschiro-dev-app');
  await site.call('Page.enable');
  await site.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), 1`);
  await site.call('Page.navigate', { url: START });
  await sleep(1500);
  await site.call('Page.handleJavaScriptDialog', { accept: true }).catch(() => undefined); // a “Leave site?” from the form task
  await sleep(4000);
  site.ws.close();

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
  if (!rec) {
    rows.push({ task: `T${i + 1}`, status: 'timeout' });
    continue;
  }
  const calls = rec.calls ?? [];
  const sum = (f) => calls.reduce((n, c) => n + (f(c) ?? 0), 0);
  const parts = ['system', 'knowledge', 'tools', 'pages', 'rest'].map((p) => [p, Math.round(sum((c) => c.parts?.[p]) / Math.max(1, calls.length))]);
  const row = {
    task: `T${i + 1}`,
    status: rec.status,
    calls: calls.length,
    steps: rec.steps.length,
    tokensIn: sum((c) => c.inputTokens),
    cached: sum((c) => c.cachedTokens),
    out: sum((c) => c.outputTokens),
    cost: +sum((c) => c.cost).toFixed(5),
    secs: Math.round(((rec.endedAt ?? 0) - rec.startedAt) / 1000),
    perCall: Object.fromEntries(parts),
    result: (rec.result || rec.error || '').replace(/\s+/g, ' ').slice(0, 110),
  };
  rows.push(row);
  console.log(JSON.stringify(row));
}
const total = rows.reduce((t, r) => ({ calls: t.calls + (r.calls ?? 0), tokensIn: t.tokensIn + (r.tokensIn ?? 0), cached: t.cached + (r.cached ?? 0), out: t.out + (r.out ?? 0), cost: +(t.cost + (r.cost ?? 0)).toFixed(5) }), { calls: 0, tokensIn: 0, cached: 0, out: 0, cost: 0 });
console.log('TOTAL', JSON.stringify(total));
appendFileSync('token-bench-results.jsonl', JSON.stringify({ label, at: new Date().toISOString(), rows, total }) + '\n');
process.exit(0);
