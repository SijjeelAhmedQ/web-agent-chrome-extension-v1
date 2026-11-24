// The open tabs: address and title. Query strings are left out — a sign-in link carries a token
// (the Smart Inbox's encryptedString) that must not be printed.
import puppeteer from 'puppeteer';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
const b = await puppeteer.connect({ browserWSEndpoint: readFileSync(join(import.meta.dirname, '..', 'indici-live', 'indici-ws.txt'), 'utf8').trim(), defaultViewport: null });
const bare = (url) => url.replace(/[?#].*$/, (q) => (q.length > 1 ? `${q[0]}…` : ''));
for (const p of await b.pages()) console.log(bare(p.url()), '|', await p.title());
b.disconnect();
