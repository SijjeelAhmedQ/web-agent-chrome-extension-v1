import { connect } from './indici-live.mjs';
const { browser, page } = await connect();
console.log(await page.evaluate(() => {
  let e = document.querySelector('#thisShowHide');
  const out = [];
  for (let i = 0; e && i < 5; i++, e = e.parentElement) out.push(`${e.tagName}#${e.id}.${String(e.className).slice(0, 40)} cursor=${getComputedStyle(e).cursor} w=${e.offsetWidth} h=${e.offsetHeight}`);
  return out.join('\n');
}));
browser.disconnect();
