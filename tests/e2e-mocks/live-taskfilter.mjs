import { connect, capture } from './indici-live.mjs';
const { browser, page } = await connect();
const n = await page.evaluate(() => {
  const all = [...document.querySelectorAll('#showHide')].filter((e) => e.offsetWidth);
  const el = all.find((e) => { const r = e.getBoundingClientRect(); return r.left > 900 && r.left < 1100; });
  el?.click();
  return all.length;
});
await new Promise((r) => setTimeout(r, 2500));
console.log('showHide count', n, 'captured', await capture(page, 'task-filters'));
browser.disconnect();
