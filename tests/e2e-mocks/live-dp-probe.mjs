import { connect } from './indici-live.mjs';
const { browser, page } = await connect();
const state = () => page.evaluate(() => [...document.querySelectorAll('[class*=datepicker]')].filter((e) => e.offsetWidth > 0 && /dropdown|days/.test(e.className)).map((e) => e.className.slice(0, 60)));
console.log('before', await state());
await page.focus('#LargePopupModel_Tasks #EndDate');
await new Promise((r) => setTimeout(r, 700));
console.log('after focus', await state());
await page.click('#LargePopupModel_Tasks #EndDate');
await new Promise((r) => setTimeout(r, 700));
console.log('after click', await state());
const icon = await page.$('#LargePopupModel_Tasks #EndDate + .input-group-addon');
if (icon) { await icon.click(); await new Promise((r) => setTimeout(r, 700)); console.log('after icon', await state()); }
browser.disconnect();
