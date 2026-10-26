// Real models on OpenRouter, on the mock Add Task page: the agent's model (WORKER) and its decision model
// (DECIDER). Prints which model answered each call, and whether reasoning came back and went back.
//   node openrouter-smoke.mjs <dist>   (WORKER, DECIDER, THINKING optional)
import puppeteer from 'puppeteer';
import { readFileSync } from 'node:fs';

const EXT = process.argv[2];
const key = readFileSync('C:/Users/92313/.webagent-openrouter.env', 'utf8').match(/OPENROUTER_KEY\s*=\s*(\S+)/)?.[1];
if (!key) throw new Error('no OPENROUTER_KEY');
const WORKER = process.env.WORKER ?? 'google/gemini-3.8-flash';
const DECIDER = process.env.DECIDER ?? 'typesafe/jev-router';
const THINKING = process.env.THINKING ?? 'low';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOOLS = ['read_page', 'find_element', 'scroll', 'wait', 'click', 'click_text', 'type', 'clear', 'select_option', 'hover', 'open_menu', 'press_key', 'navigate', 'go_back', 'go_forward', 'list_tabs', 'open_tab', 'switch_tab', 'close_tab'];

const browser = await puppeteer.launch({ headless: true, protocolTimeout: 900000, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
try {
  const extId = new URL((await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'))).url()).host;
  const panel = await browser.newPage();
  await panel.setViewport({ width: 420, height: 900 });
  const calls = [];
  panel.on('response', async (res) => {
    if (!/openrouter\.ai\/api\/v1\/chat/.test(res.url())) return;
    try {
      const req = JSON.parse(res.request().postData() ?? '{}');
      const body = await res.json();
      const msg = body.choices?.[0]?.message ?? {};
      calls.push({
        model: req.model,
        reasoning: JSON.stringify(req.reasoning ?? null),
        sentBack: req.messages.filter((m) => m.reasoning_details).length,
        gotReasoning: !!msg.reasoning_details?.length,
        tool: msg.tool_calls?.map((c) => c.function?.name).join(',') || '(answer)',
        servedBy: body.model,
        error: body.error?.message,
        cost: body.usage?.cost,
      });
    } catch {}
  });
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  await panel.evaluate(async (tools, key, worker, decider, thinking) => {
    const provider = { id: 'or', name: 'OpenRouter', kind: 'openai', preset: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: key, defaultModel: worker, thinking, createdAt: 1 };
    const agent = { id: 'agent-assistant', name: 'Assistant', description: '', avatar: { icon: 'Sparkles', color: '#10b981' }, instructions: '', providerId: 'or', model: worker, decision: decider ? { providerId: 'or', model: decider } : null, temperature: 0.1, maxSteps: 25, confirmation: 'smart', toolIds: tools, skillIds: [], createdAt: 1, updatedAt: 1 };
    await chrome.storage.local.set({ 'wa.config': { version: 1, providers: [provider], agents: [agent], skills: [], customTools: [], sites: [], settings: { defaultProviderId: 'or', defaultAgentId: 'agent-assistant', developerMode: true, expandActivity: true, knownToolIds: tools } } });
    await chrome.storage.session.remove('wa.chat');
  }, TOOLS, key, WORKER, DECIDER, THINKING);
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });
  await page.goto('http://localhost:4599/addtask.html');
  await page.bringToFront();
  await panel.reload();
  await panel.waitForSelector('#composer-input');
  await sleep(500);
  await panel.$eval('#composer-input', (el) => el.focus());
  await panel.keyboard.type('In the Add Task form that is open, type the subject "smoke test - review bloods" and the due date 30/10/2026, then save it');
  await panel.keyboard.press('Enter');
  const t0 = Date.now();
  let card = '';
  let sawLabel = '';
  for (;;) {
    if (Date.now() - t0 > Number(process.env.LIMIT_S ?? 600) * 1000) {
      const lines = (await panel.$eval('.turn:last-child', (e) => e.innerText)).split('\n');
      console.log('TIMED OUT — activity so far:');
      console.log(lines.filter((l) => l.trim() && !/^(Done|Details)$|Details$|^[0-9.]+s$/.test(l.trim())).slice(-40).join('\n'));
      break;
    }
    const label = await panel.$eval('.step.thinking .step-label', (e) => e.textContent).catch(() => '');
    if (/·/.test(label) && !sawLabel.includes(label)) sawLabel += (sawLabel ? ' / ' : '') + label;
    if (await panel.$('.approval')) {
      card = await panel.$eval('.approval', (e) => e.innerText.replace(/\s+/g, ' '));
      // A form's buttons: Save. A plain card: Confirm.
      await panel.evaluate(() => {
        const bs = [...document.querySelectorAll('.approval-actions button')];
        (bs.find((b) => b.textContent.trim() === 'Save') ?? bs.find((b) => b.textContent.trim() === 'Confirm'))?.click();
      });
      await sleep(800);
    }
    if (await panel.$('.turn:last-child .activity.done, .turn:last-child .activity.failed, .turn:last-child .notice.error')) break;
    await sleep(500);
  }
  await sleep(500);
  console.log(`time: ${Math.round((Date.now() - t0) / 1000)}s · page clicked: ${await page.evaluate(() => window.__clicked ?? '')} · subject: ${await page.$eval('#subj', (e) => e.value)} · due: ${await page.$eval('#due', (e) => e.value)}`);
  console.log(`thinking label seen: ${sawLabel || '(none)'}`);
  console.log(`card: ${card.slice(0, 220)}`);
  for (const [i, c] of calls.entries()) console.log(`${i + 1}. ${c.model} (served by ${c.servedBy}) reasoning=${c.reasoning} sentBack=${c.sentBack} gotReasoning=${c.gotReasoning} cost=${c.cost ?? '?'} → ${c.tool}${c.error ? ` ERROR ${c.error}` : ''}`);
  console.log('answer:', (await panel.$eval('.turn:last-child', (e) => e.innerText)).replace(/\s+/g, ' ').slice(-400));
} finally {
  await browser.close();
}
