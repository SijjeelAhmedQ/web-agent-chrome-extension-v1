import puppeteer from 'puppeteer';
import { readFileSync } from 'node:fs';
const b = await puppeteer.connect({ browserWSEndpoint: readFileSync('../indici-live/indici-ws.txt', 'utf8').trim(), defaultViewport: null });
for (const t of b.targets()) console.log(t.type(), t.url().slice(0, 100));
b.disconnect();
