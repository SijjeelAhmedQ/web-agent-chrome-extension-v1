// Closes the Smart Inbox tabs and brings the Indici tab to the front — a run then starts from the dashboard.
import puppeteer from 'puppeteer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const b = await puppeteer.connect({ browserWSEndpoint: readFileSync(join(import.meta.dirname, '..', 'indici-live', 'indici-ws.txt'), 'utf8').trim(), defaultViewport: null });
for (const p of await b.pages()) if (/inbox-app-dev\.vitonta\.com/.test(p.url())) await p.close();
const indici = (await b.pages()).filter((p) => /pmstraining\.vitonta\.com/.test(p.url())).at(-1);
await indici?.bringToFront();
console.log('front:', indici ? await indici.title() : 'no Indici tab');
b.disconnect();
