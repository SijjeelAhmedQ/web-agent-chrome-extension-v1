// Puts the blank keeper tab back (closing the last Indici tab must never close the window).
import puppeteer from 'puppeteer';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
const b = await puppeteer.connect({ browserWSEndpoint: readFileSync(join(import.meta.dirname, '..', 'indici-live', 'indici-ws.txt'), 'utf8').trim(), defaultViewport: null });
const pages = await b.pages();
if (!pages.some((p) => p.url() === 'about:blank')) { const k = await b.newPage(); await k.goto('about:blank'); console.log('keeper added'); }
for (const p of pages) if (/options\.html/.test(p.url())) await p.close();
const consult = pages.find((p) => /accordionslider/.test(p.url()));
if (consult) await consult.bringToFront();
b.disconnect();
