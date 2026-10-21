import { connect } from './indici-live.mjs';
const { browser, page } = await connect();
console.log(await page.evaluate(() => {
  const box = document.querySelector('#LargePopupModel_Tasks #AssignedTo')?.nextElementSibling;
  return box ? box.outerHTML.replace(/\s+/g, ' ').slice(0, 1500) : 'no picker';
}));
browser.disconnect();
