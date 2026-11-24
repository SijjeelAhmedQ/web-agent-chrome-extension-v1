import { connect } from './indici-live.mjs';
const { browser, page } = await connect();
console.log(await page.evaluate(() => [...document.querySelectorAll('#showHide')].map((e) => `${e.outerHTML.slice(0, 200)} visible=${!!e.offsetWidth} parent=${e.parentElement.outerHTML.slice(0, 160)}`).join('\n')));
browser.disconnect();
