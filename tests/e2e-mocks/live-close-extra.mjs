// Closes every Indici tab but the first (the keeper and the first Indici tab stay) — no navigation.
import puppeteer from 'puppeteer';
import { readFileSync } from 'node:fs';
const b = await puppeteer.connect({ browserWSEndpoint: readFileSync('../indici-live/indici-ws.txt', 'utf8').trim(), defaultViewport: null });
const [, ...rest] = (await b.pages()).filter((p) => /vitonta\.com/.test(p.url()));
for (const p of rest) { console.log('closing', p.url().slice(0, 70)); await p.close(); }
for (const p of await b.pages()) if (/options\.html/.test(p.url())) await p.close();
b.disconnect();
