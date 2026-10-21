// Reloads the Web Agent extension in the logged-in window (after a new build).
import puppeteer from 'puppeteer';
import { readFileSync } from 'node:fs';
const b = await puppeteer.connect({ browserWSEndpoint: readFileSync('../indici-live/indici-ws.txt', 'utf8').trim(), defaultViewport: null });
const p = await b.newPage();
await p.goto('chrome-extension://blhiljoicnofbjihhkpffchgpnpmnddi/options.html');
await p.evaluate(() => setTimeout(() => chrome.runtime.reload(), 100)).catch(() => {});
await new Promise((r) => setTimeout(r, 2500));
await p.close().catch(() => {});
console.log('reloaded');
b.disconnect();
