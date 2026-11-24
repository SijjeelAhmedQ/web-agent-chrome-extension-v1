// The side panel now: the approval card waiting, if any, and the end of the last turn.
import puppeteer from 'puppeteer';
import { readFileSync } from "node:fs";
import { join } from "node:path";
const DIR = join(import.meta.dirname, "..", "indici-live");
const extId = readFileSync(`${DIR}/ext-id.txt`, 'utf8').trim();
const b = await puppeteer.connect({ browserWSEndpoint: readFileSync(`${DIR}/indici-ws.txt`, 'utf8').trim(), defaultViewport: null });
const t = b.targets().find((t) => t.url().startsWith(`chrome-extension://${extId}/sidepanel.html`));
const p = t.type() === 'page' ? await t.page() : await t.asPage();
console.log('approval:', await p.$eval('.approval', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => 'none'));
console.log('last turn:', (await p.$eval('.turn:last-child', (e) => e.innerText).catch(() => '')).slice(-600));
b.disconnect();
