import puppeteer from 'puppeteer';
import { readFileSync } from 'node:fs';
const b = await puppeteer.launch({ headless: true });
const p = await b.newPage();
await p.goto('http://localhost:4599/legacy.html?plain=1');
await p.evaluate(() => { window.chrome = { runtime: { onMessage: { addListener: (f) => (window.__l = f) } } }; });
await p.evaluate(readFileSync(process.argv[2], 'utf8'));
for (const req of JSON.parse(process.argv[3])) {
  const r = await p.evaluate((req) => new Promise((res) => window.__l({ channel: 'web-agent/v1', request: req }, {}, res)), req);
  console.log(JSON.stringify(r).slice(0, 600));
}
await b.close();
