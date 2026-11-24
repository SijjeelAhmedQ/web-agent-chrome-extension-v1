// Automatic backup (Downloads/WebAgent/web-agent-backup.json, no keys) and "Add from file" bringing it back.
import puppeteer from 'puppeteer';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const EXT = process.argv[2];
const DL = join(import.meta.dirname, 'dl-test');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
};
rmSync(DL, { recursive: true, force: true });
mkdirSync(DL, { recursive: true });

const browser = await puppeteer.launch({ headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
try {
  // Downloads go to a scratch folder, never the real Downloads.
  const cdp = await browser.target().createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
  const extId = new URL((await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'))).url()).host;
  const opts = await browser.newPage();
  await opts.goto(`chrome-extension://${extId}/options.html#/advanced`);
  await sleep(800);
  // The setup the user built: a connection with a key, the indici agent and its site with knowledge.
  await opts.evaluate(async () => {
    const { 'wa.config': cfg } = await chrome.storage.local.get('wa.config');
    const base = cfg ?? { version: 1, providers: [], agents: [], skills: [], customTools: [], sites: [], settings: {} };
    base.providers = [{ id: 'or', name: 'OpenRouter', kind: 'openai', preset: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-secret-123', defaultModel: 'deepseek/deepseek-v4-flash', createdAt: 1 }];
    base.agents = [...(base.agents ?? []), { id: 'agent-indici', name: 'indici agent', description: '', avatar: { icon: 'Stethoscope', color: '#0e7490' }, instructions: '', providerId: null, model: '', temperature: 0.2, maxSteps: 40, confirmation: 'smart', toolIds: ['read_page', 'click'], skillIds: [], createdAt: 1, updatedAt: 1 }];
    base.sites = [{ id: 'site_indici', name: 'indici training', description: '', color: '#0e7490', sites: ['pmstraining.vitonta.com'], enabled: true, providerId: null, model: '', agentIds: ['agent-indici'], skillIds: [], disabledSkillIds: [], customToolIds: [], disabledToolIds: [], neverClick: [], knowledge: [{ id: 'k1', kind: 'rule', title: 'Pop-ups when a consult opens', content: 'Close the ones with ×.', enabled: true, createdAt: 1, updatedAt: 1 }], createdAt: 1, updatedAt: 1 }];
    await chrome.storage.local.set({ 'wa.config': base });
  });
  // Real Chrome saves Downloads/WebAgent/web-agent-backup.json; the test's download override names it itself.
  const found = () => readdirSync(DL, { recursive: true }).map(String).find((f) => f.endsWith('.json'));
  for (let i = 0; i < 40 && !found(); i++) await sleep(500);
  const file = found() ? join(DL, found()) : join(DL, 'none.json');
  await sleep(800);
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  check('a change to the setup writes the backup file, without the API key', /"indici agent"/.test(text) && /Pop-ups when a consult opens/.test(text) && !/sk-secret-123/.test(text), existsSync(file) ? `${text.length} chars` : 'no file');

  // The extension removed and added again: everything stored is gone — only the defaults.
  await opts.evaluate(async () => {
    const { defaultConfig } = { defaultConfig: null };
    await chrome.storage.local.set({ 'wa.config': { version: 1, providers: [{ id: 'or2', name: 'OpenRouter', kind: 'openai', preset: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-new-key', defaultModel: 'deepseek/deepseek-v4-flash', createdAt: 2 }], agents: [], skills: [], customTools: [], sites: [], settings: { defaultProviderId: 'or2' } } });
  });
  await opts.reload();
  await sleep(1200);
  const [chooser] = await Promise.all([opts.waitForFileChooser(), opts.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Add from file/.test(b.textContent ?? ''))?.click())]);
  await chooser.accept([file]);
  await sleep(600);
  const confirm = await opts.evaluate(() => document.querySelector('.ant-modal-confirm-content')?.textContent ?? '');
  await opts.evaluate(() => [...document.querySelectorAll('.ant-modal-confirm-btns button')].find((b) => /Add/.test(b.textContent ?? ''))?.click());
  await sleep(800);
  const after = await opts.evaluate(async () => (await chrome.storage.local.get('wa.config'))['wa.config']);
  const agent = after.agents.find((a) => a.name === 'indici agent');
  const site = after.sites.find((s) => s.name === 'indici training');
  check('Add from file brings back the agent and the site with its knowledge', !!agent && site?.knowledge?.[0]?.title === 'Pop-ups when a consult opens' && /1 agents?, 1 sites?/.test(confirm), confirm.slice(0, 160));
  check('…and keeps the new connection and its key — no keyless copy of the old one', after.providers.length === 1 && after.providers[0].id === 'or2' && after.providers[0].apiKey === 'sk-new-key', after.providers.map((p) => `${p.id}:${p.apiKey ? 'key' : 'no key'}`).join(', '));
} catch (err) {
  console.error('E2E error:', err);
  results.push(false);
} finally {
  await browser.close();
  rmSync(DL, { recursive: true, force: true });
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
}
