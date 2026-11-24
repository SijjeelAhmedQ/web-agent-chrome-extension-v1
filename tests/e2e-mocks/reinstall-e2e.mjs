// Installed again after removal: the options page offers to restore the backup, and one file brings it all back.
import puppeteer from 'puppeteer';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const EXT = process.argv[2];
const DL = join(import.meta.dirname, 'dl-reinstall');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
};
rmSync(DL, { recursive: true, force: true });
mkdirSync(DL, { recursive: true });
const launch = () => puppeteer.launch({ headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });

// 1. The first install: the user builds a setup, with "Include API keys in the backup" on.
let browser = await launch();
let backup = '';
try {
  const cdp = await browser.target().createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
  const extId = new URL((await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'))).url()).host;
  const p = await browser.newPage();
  await p.goto(`chrome-extension://${extId}/options.html#/advanced`);
  await sleep(1000);
  await p.evaluate(async () => {
    let cfg = null;
    for (let i = 0; i < 20 && !cfg; i++) {
      cfg = (await chrome.storage.local.get('wa.config'))['wa.config'] ?? null;
      if (!cfg) await new Promise((r) => setTimeout(r, 250));
    }
    const agent = { id: 'agent-assistant', name: 'Assistant', description: '', avatar: { icon: 'Sparkles', color: '#10b981' }, instructions: '', providerId: null, model: '', temperature: 0.2, maxSteps: 25, confirmation: 'smart', toolIds: ['read_page'], skillIds: [], createdAt: 1, updatedAt: 1 };
    const skill = { id: 'skill-x', name: 'x', description: '', instructions: 'x', activation: 'on-demand', createdAt: 1, updatedAt: 1 };
    cfg = cfg ?? { version: 1, providers: [], agents: [agent], skills: [skill], customTools: [], sites: [], settings: {} };
    if (!cfg.agents?.length) cfg.agents = [agent];
    if (!cfg.skills?.length) cfg.skills = [skill];
    cfg.providers = [{ id: 'or', name: 'OpenRouter', kind: 'openai', preset: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-key', defaultModel: 'deepseek/deepseek-v4-flash', createdAt: 1 }];
    cfg.settings.defaultProviderId = 'or';
    cfg.settings.backupKeys = true;
    cfg.agents.push({ ...cfg.agents[0], id: 'agent-indici', name: 'indici agent' });
    cfg.skills.push({ ...cfg.skills[0], id: 'skill-mine', name: 'My skill' });
    cfg.sites = [{ id: 'site_indici', name: 'indici training', description: '', color: '#0e7490', sites: ['pmstraining.vitonta.com'], enabled: true, providerId: null, model: '', agentIds: ['agent-indici'], skillIds: [], disabledSkillIds: [], customToolIds: [], disabledToolIds: [], neverClick: ['Pharmac'], knowledge: [{ id: 'k1', kind: 'rule', title: 'Pop-ups when a consult opens', content: 'x', enabled: true, createdAt: 1, updatedAt: 1 }], createdAt: 1, updatedAt: 1 }];
    await chrome.storage.local.set({ 'wa.config': cfg });
  });
  const found = () => readdirSync(DL, { recursive: true }).map(String).find((f) => f.endsWith('.json'));
  for (let i = 0; i < 40 && !found(); i++) await sleep(500);
  await sleep(800);
  backup = found() ? join(DL, found()) : '';
  const text = backup ? readFileSync(backup, 'utf8') : '';
  check('the backup has everything — and the key, as the user chose', /indici agent/.test(text) && /My skill/.test(text) && /Pharmac/.test(text) && /sk-or-key/.test(text), backup ? `${text.length} chars` : 'no file');
} finally {
  await browser.close();
}

// 2. Removed and added again: a new browser profile — nothing stored. The welcome page offers the restore.
browser = await launch();
try {
  const extId = new URL((await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'))).url()).host;
  await sleep(1500);
  const welcome = (await browser.pages()).find((p) => p.url().includes(`${extId}/options.html`)) ?? (await browser.newPage());
  if (!welcome.url().includes('options.html')) await welcome.goto(`chrome-extension://${extId}/options.html`);
  await welcome.waitForSelector('.restore-banner', { timeout: 8000 }).catch(() => undefined);
  const offered = await welcome.$eval('.restore-banner', (e) => e.innerText).catch(() => '');
  check('right after installing, the options page offers to restore the backup', /Restore from backup/.test(offered) && /web-agent-backup\.json/.test(offered), offered.replace(/\n/g, ' ').slice(0, 160));
  const [chooser] = await Promise.all([welcome.waitForFileChooser(), welcome.click('.restore-banner .ant-btn-primary')]);
  await chooser.accept([backup]);
  await sleep(1200);
  const c = await welcome.evaluate(async () => (await chrome.storage.local.get('wa.config'))['wa.config']);
  const site = c.sites.find((s) => s.name === 'indici training');
  check('one file brings back agents, skills, the site with its knowledge and never-click list, and the working connection', c.agents.some((a) => a.name === 'indici agent') && c.skills.some((s) => s.name === 'My skill') && site?.knowledge?.length === 1 && site?.neverClick?.[0] === 'Pharmac' && c.providers.some((p) => p.apiKey === 'sk-or-key'), `${c.agents.length} agents, ${c.skills.length} skills, site ${!!site}, keys ${c.providers.map((p) => (p.apiKey ? 'yes' : 'no')).join('/')}`);
  const gone = !(await welcome.$('.restore-banner'));
  const flag = await welcome.evaluate(async () => (await chrome.storage.local.get('wa.freshInstall'))['wa.freshInstall'] ?? null);
  check('the offer goes away once restored', gone && flag === null, `banner gone ${gone}, flag ${flag}`);
} catch (err) {
  console.error('E2E error:', err);
  results.push(false);
} finally {
  await browser.close();
  rmSync(DL, { recursive: true, force: true });
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
}
