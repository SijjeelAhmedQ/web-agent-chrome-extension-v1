import { connect } from './indici-live.mjs';
const { browser, page } = await connect();
console.log(await page.evaluate(() => ['#thisShowHide', '#showHide'].map((s) => { const e = document.querySelector(s); return `${s} cursor=${getComputedStyle(e).cursor} onclick=${!!e.onclick} tabindex=${e.getAttribute('tabindex')}`; }).join('\n')));
browser.disconnect();
