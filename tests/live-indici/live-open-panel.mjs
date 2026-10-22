// Opens the Web Agent side panel beside the Indici tab — what clicking the extension's icon does — after a
// reinstall closed it. chrome.sidePanel.open needs a user gesture; CDP gives the call one.
import puppeteer from 'puppeteer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dirname, '..', 'indici-live');
const extId = readFileSync(join(DIR, 'ext-id.txt'), 'utf8').trim();
const b = await puppeteer.connect({ browserWSEndpoint: readFileSync(join(DIR, 'indici-ws.txt'), 'utf8').trim(), defaultViewport: null });
const site = (await b.pages()).filter((p) => /vitonta\.com/.test(p.url())).at(-1);
await site.bringToFront();
const page = await b.newPage();
await page.goto(`chrome-extension://${extId}/options.html`);
const cdp = await page.createCDPSession();
const res = await cdp.send('Runtime.evaluate', {
  expression: `(async () => {
    const [tab] = await chrome.tabs.query({ url: '*://pmstraining.vitonta.com/*' });
    await chrome.sidePanel.open({ windowId: tab.windowId });
    return 'opened beside ' + tab.title;
  })()`,
  awaitPromise: true,
  userGesture: true,
  returnByValue: true,
});
console.log(res.exceptionDetails ? `failed: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}` : res.result.value);
await page.close();
await site.bringToFront();
b.disconnect();
