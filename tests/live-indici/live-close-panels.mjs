// Closes any side-panel tabs left open by a stopped run (the agent in them stops with them).
import puppeteer from 'puppeteer';
import { readFileSync } from 'node:fs';
const b = await puppeteer.connect({ browserWSEndpoint: readFileSync('../indici-live/indici-ws.txt', 'utf8').trim(), defaultViewport: null });
for (const p of await b.pages()) if (/sidepanel\.html/.test(p.url())) { console.log('closing panel'); await p.close(); }
b.disconnect();
