// Every line of the live page's text (visible or not, frames included) that matches a pattern.
import { connect } from './indici-live.mjs';
const { browser, page } = await connect();
const re = process.argv[2];
const out = await page.evaluate((src) => {
  const r = new RegExp(src, 'i');
  const docs = [document, ...[...document.querySelectorAll('iframe')].map((f) => { try { return f.contentDocument; } catch { return null; } }).filter(Boolean)];
  return docs.flatMap((d) => (d.body?.textContent ?? '').split(/\n|\s{3,}/).map((l) => l.trim()).filter((l) => r.test(l))).slice(0, 30);
}, re);
console.log(out.join('\n'));
browser.disconnect();
