// Closes consult tabs — never the last Indici tab (that one goes back to the dashboard instead).
import puppeteer from 'puppeteer';
import { readFileSync } from 'node:fs';
const b = await puppeteer.connect({ browserWSEndpoint: readFileSync('../indici-live/indici-ws.txt', 'utf8').trim(), defaultViewport: null });
const indici = (await b.pages()).filter((p) => /vitonta\.com/.test(p.url()));
const [home, ...rest] = indici;
for (const p of rest) { console.log('closing', p.url().slice(0, 80)); await p.close(); }
if (home && (!/DashBoard/i.test(home.url()) || /timeout|error/i.test(await home.title()))) await home.goto('https://pmstraining.vitonta.com/ProviderDashboard/DashBoard', { waitUntil: 'domcontentloaded', timeout: 120000 }).catch((e) => console.log('dashboard:', e.message));
for (const p of await b.pages()) if (/options\.html/.test(p.url())) await p.close();
b.disconnect();
