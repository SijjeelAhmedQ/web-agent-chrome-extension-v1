// Closes the Smart AI Inbox tabs (and the options page) — to try opening the inbox from Indici again.
import puppeteer from 'puppeteer';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
const b = await puppeteer.connect({ browserWSEndpoint: readFileSync(join(import.meta.dirname, '..', 'indici-live', 'indici-ws.txt'), 'utf8').trim(), defaultViewport: null });
for (const p of await b.pages()) if (/inbox-app-dev\.vitonta\.com|options\.html/.test(p.url())) { console.log('closing', p.url().slice(0, 70)); await p.close(); }
b.disconnect();
