// Lists visible controls whose title/text/id matches a pattern: node live-find.mjs "<regex>"
import { connect } from './indici-live.mjs';
const { browser, page } = await connect();
const out = await page.evaluate((src) => {
  const re = new RegExp(src, 'i');
  const vis = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length) && getComputedStyle(e).visibility !== 'hidden';
  return [...document.querySelectorAll('*')].filter((e) => vis(e) && (re.test(e.getAttribute('title') ?? '') || re.test(e.id) || (e.children.length === 0 && re.test(e.textContent ?? '')))).slice(0, 25).map((e) => {
    const r = e.getBoundingClientRect();
    return `${e.tagName}#${e.id} .${String(e.className).slice(0, 40)} title="${e.getAttribute('title') ?? ''}" text="${(e.textContent ?? '').trim().slice(0, 40)}" @${Math.round(r.x)},${Math.round(r.y)}`;
  });
}, process.argv[2]);
console.log(out.join('\n'));
browser.disconnect();
