// Reloads the Smart Inbox tab, so each measured run starts from the same page.
import puppeteer from 'puppeteer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIR } from './indici-live.mjs';
const browser = await puppeteer.connect({ browserWSEndpoint: readFileSync(join(DIR, 'indici-ws.txt'), 'utf8').trim(), defaultViewport: null });
const tab = (await browser.pages()).filter((p) => /inbox-app/.test(p.url())).at(-1);
await tab.reload({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 4000));
console.log('reloaded', tab.url().replace(/\?.*/, ''));
browser.disconnect();
