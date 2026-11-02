// The real Web Agent, with a real model (DeepSeek on OpenRouter), on the live Indici training site,
// in the window the user logged in to. Requests come one per turn:
//   REQUESTS='["open arya stark", "follow up"]' APPROVE='reason to view' node live-agent.mjs
// Approvals are declined unless their text matches APPROVE (a regex) — writes only with the user's leave.
// The key is read from the user's file at run time; it is never printed or saved anywhere else.
import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIR } from './indici-live.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Kaggle (C:/Users/92313/.webagent-kaggle.env: KAGGLE_URL=…, KAGGLE_KEY=…) when PROVIDER=kaggle, else OpenRouter.
const envFile = (path) => { try { return readFileSync(path, 'utf8'); } catch { return ''; } };
const kaggleEnv = envFile('C:/Users/92313/.webagent-kaggle.env');
const useKaggle = process.env.PROVIDER === 'kaggle';
const key = useKaggle ? kaggleEnv.match(/KAGGLE_KEY\s*=\s*(\S+)/)?.[1] : envFile('C:/Users/92313/.webagent-openrouter.env').match(/OPENROUTER_KEY\s*=\s*(\S+)/)?.[1];
const kaggleUrl = kaggleEnv.match(/KAGGLE_URL\s*=\s*(\S+)/)?.[1]?.replace(/\/+$/, '');
if (!key || (useKaggle && !kaggleUrl)) throw new Error(useKaggle ? 'no KAGGLE_URL / KAGGLE_KEY in the Kaggle env file' : 'no OPENROUTER_KEY in the env file');
const requests = JSON.parse(process.env.REQUESTS ?? '[]');
const approve = process.env.APPROVE ? new RegExp(process.env.APPROVE, 'i') : null;
// PANEL=side: drive the extension's real side panel beside the site, instead of a tab of its own.
const sidePanel = process.env.PANEL === 'side';
const restore = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'knowledge', 'web-agent-restore-indici.json'), 'utf8'));
const extId = readFileSync(join(DIR, 'ext-id.txt'), 'utf8').trim();

const browser = await puppeteer.connect({ browserWSEndpoint: readFileSync(join(DIR, 'indici-ws.txt'), 'utf8').trim(), defaultViewport: null, protocolTimeout: 1800000 });
const log = [];
const say = (s) => { console.log(s); log.push(s); };
let panel;
try {
  // SITE=pmstraining: the tab to work on when several are open (otherwise the last vitonta one).
  const site = (await browser.pages()).filter((p) => new RegExp(process.env.SITE ?? 'vitonta\\.com').test(p.url())).at(-1);
  if (sidePanel) {
    // The extension's own side panel, beside the site — opened by the user with the extension's icon.
    const target = browser.targets().find((t) => t.url().startsWith(`chrome-extension://${extId}/sidepanel.html`));
    if (!target) throw new Error('No side panel open — click the Web Agent icon in the toolbar to open it beside the site, then run again.');
    panel = target.type() === 'page' ? await target.page() : await target.asPage();
  } else {
    panel = await browser.newPage();
    await panel.setViewport({ width: 460, height: 1000 });
  }
  // Every model call, as sent and as answered — to see what the model saw (the key header is not kept).
  const calls = [];
  panel.on('response', async (res) => {
    if (!/openrouter\.ai\/api\/v1\/chat|\/vllm\/v1\/chat/.test(res.url())) return;
    try {
      calls.push({ request: JSON.parse(res.request().postData() ?? '{}'), response: await res.json() });
      writeFileSync(join(DIR, 'model-calls.json'), JSON.stringify(calls, null, 1));
    } catch {}
  });
  if (!sidePanel) await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  const provider = useKaggle
    ? { id: 'p', name: 'Kaggle GPU', kind: 'openai', preset: 'kaggle', baseUrl: `${kaggleUrl}/vllm/v1`, apiKey: key, keyHeader: 'X-CareFlow-Key', timeoutMs: 600000, contextWindow: Number(process.env.CTX ?? 16384), defaultModel: process.env.MODEL ?? 'qwen3.8:27b-q4_K_M', createdAt: 1 }
    : { id: 'p', name: 'OpenRouter', kind: 'openai', preset: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: key, timeoutMs: 300000, defaultModel: process.env.MODEL ?? '~deepseek/deepseek-v4-flash-latest', createdAt: 1 };
  // The model and knowledge are set every run; KEEP_CHAT keeps the conversation (a reply to the agent's question).
  await panel.evaluate(async (provider, agents, sites, keep) => {
    const toolIds = agents[0].toolIds;
    await chrome.storage.local.set({ 'wa.config': { version: 1, providers: [provider], agents: agents.map((a) => ({ ...a, providerId: 'p' })), skills: [], customTools: [], sites, settings: { defaultProviderId: 'p', defaultAgentId: agents[0].id, developerMode: true, expandActivity: true, autoBackup: false, knownToolIds: toolIds } } });
    if (!keep) await chrome.storage.session.remove('wa.chat');
  }, provider, restore.agents.map((a) => (process.env.MAX_STEPS ? { ...a, maxSteps: Number(process.env.MAX_STEPS) } : a)), restore.sites, !!process.env.KEEP_CHAT);
  await site.bringToFront();
  await panel.reload();
  await panel.waitForSelector('#composer-input');
  await sleep(800);
  // ANSWERS='[["reason to view", "follow up"], ["NZF", "OK"]]': when the agent stops with a question that matches,
  // the answer is sent in the same chat, as the user would — a whole flow with its questions in one run.
  const answers = JSON.parse(process.env.ANSWERS ?? '[]');
  const queue = [...requests];
  let answered = 0;
  while (queue.length) {
    const request = queue.shift();
    say(`\n>>> ${request}`);
    const before = await panel.$$eval('.turn', (x) => x.length);
    await panel.$eval('#composer-input', (el) => el.focus());
    await panel.keyboard.type(request);
    await panel.keyboard.press('Enter');
    const t0 = Date.now();
    for (;;) {
      if (Date.now() - t0 > Number(process.env.REQUEST_MINUTES ?? 20) * 60_000) throw new Error('timed out');
      if (await panel.$('.approval') && process.env.NO_ANSWER) {
        // Show the card only: a picture of it, then leave without pressing anything.
        await sleep(800);
        await panel.screenshot({ path: join(DIR, 'captures', 'approval-card.png'), fullPage: true });
        say(`  approval shown, not answered: ${await panel.$eval('.approval', (e) => e.innerText.replace(/\s+/g, ' '))}`);
        break;
      }
      if (await panel.$('.approval')) {
        const text = await panel.$eval('.approval', (e) => e.innerText.replace(/\s+/g, ' '));
        // A careful user: a card that matches a pattern must also show what the request asked for
        // (APPROVE_IF='[["Strength 500 mg", "Take 1 .*Frequency TDS"]]'), or it is declined.
        const wrong = JSON.parse(process.env.APPROVE_IF ?? '[]').find(([card, need]) => new RegExp(card, 'i').test(text) && !new RegExp(need, 'i').test(text));
        if (wrong) say(`  (card lacks /${wrong[1]}/ — declining)`);
        const ok = !!approve && approve.test(text) && !wrong;
        if (await panel.$('.approval-choices')) {
          // A form's own buttons: approve means only APPROVE_BUTTON (Save, or "Save|OK") — never Complete or another;
          // anything else is a no, given with the card's cancel-like button.
          const want = process.env.APPROVE_BUTTON ?? 'Save';
          const pressed = await panel.$$eval('.approval-choices button', (bs, want, ok) => {
            const label = (b) => b.textContent.trim();
            const pick = (ok && bs.find((b) => want.split("|").includes(label(b)))) || bs.find((b) => /^(cancel|close|not now)/i.test(label(b)));
            pick?.click();
            return pick ? label(pick) : 'nothing';
          }, want, ok);
          say(`  approval (form buttons): ${text.slice(0, 300)} → pressed “${pressed}”`);
        } else {
          say(`  approval: ${text.slice(0, 300)} → ${ok ? 'APPROVED' : 'declined'}`);
          await panel.$eval(ok ? '.approval .ant-btn-primary' : '.approval .ant-btn:not(.ant-btn-primary)', (b) => b.click());
        }
        await sleep(800);
      }
      if (await panel.$$eval('.turn', (x, n) => x.length > n && !!x.at(-1).querySelector('.activity.done, .activity.failed, .notice.error'), before)) break;
      await sleep(1000);
    }
    await sleep(600);
    // The task's model calls, opened: what each was for, its tokens and its cost.
    await panel.$$eval('.turn:last-child .cost-head[aria-expanded=false]', (bs) => bs.forEach((b) => b.click())).catch(() => {});
    await sleep(200);
    const turn = await panel.$eval('.turn:last-child', (e) => e.innerText);
    say(`--- ${Math.round((Date.now() - t0) / 1000)}s ---\n${turn}`);
    const asked = turn.trim().slice(-800);
    // A question near the end, though the answer may close with a note after it.
    const reply = /\?/.test(asked.slice(-300)) && answered < 12 ?answers.find(([question]) => new RegExp(question, 'i').test(asked)) : null;
    if (reply) {
      answered++;
      queue.unshift(reply[1]);
    }
  }
  await panel.screenshot({ path: join(DIR, 'captures', 'agent-panel.png'), fullPage: true }).catch(() => {});
  await site.screenshot({ path: join(DIR, 'captures', 'agent-site.png') }).catch(() => {});
} finally {
  writeFileSync(join(DIR, 'agent-run.log'), log.join('\n'));
  if (panel && !sidePanel && !process.env.KEEP_PANEL) await panel.close().catch(() => {});
  browser.disconnect();
}
