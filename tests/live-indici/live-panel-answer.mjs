// Answers the approval card waiting in the side panel: node live-panel-answer.mjs yes|no
import puppeteer from 'puppeteer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const DIR = join(import.meta.dirname, '..', 'indici-live');
const extId = readFileSync(join(DIR, 'ext-id.txt'), 'utf8').trim();
const b = await puppeteer.connect({ browserWSEndpoint: readFileSync(join(DIR, 'indici-ws.txt'), 'utf8').trim(), defaultViewport: null });
try {
  const t = b.targets().find((t) => t.url().startsWith(`chrome-extension://${extId}/sidepanel.html`));
  const p = t.type() === 'page' ? await t.page() : await t.asPage();
  const yes = process.argv[2] === 'yes';
  const card = await p.$eval('.approval', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  if (!card) console.log('no approval waiting');
  else {
    await p.$eval(yes ? '.approval .ant-btn-primary' : '.approval .ant-btn:not(.ant-btn-primary)', (x) => x.click());
    console.log(`${yes ? 'approved' : 'declined'}: ${card.slice(0, 200)}`);
  }
} finally { b.disconnect(); }
