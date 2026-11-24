import { connect, capture } from './indici-live.mjs';
const { browser, page } = await connect();
await page.evaluate(() => { window.scrollTo(0, 0); for (const e of document.querySelectorAll('*')) if (e.scrollTop > 0) e.scrollTop = 0; });
await new Promise((r) => setTimeout(r, 800));
console.log('captured', await capture(page, process.argv[2] ?? 'top'));
browser.disconnect();
