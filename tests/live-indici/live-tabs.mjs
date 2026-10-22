import puppeteer from 'puppeteer';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
const b = await puppeteer.connect({ browserWSEndpoint: readFileSync(join(import.meta.dirname, '..', 'indici-live', 'indici-ws.txt'), 'utf8').trim(), defaultViewport: null });
for (const p of await b.pages()) console.log(p.url(), '|', await p.title());
b.disconnect();
