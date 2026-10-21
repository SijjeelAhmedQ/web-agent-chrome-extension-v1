import { connect } from './indici-live.mjs';
const { browser, page } = await connect();
console.log(await page.evaluate(() => {
  const all = document.body.getElementsByTagName('*');
  const save = document.getElementById('savetask_add');
  let index = -1;
  for (let i = 0; i < all.length; i++) if (all[i] === save) { index = i; break; }
  return `elements in body: ${all.length}; Save is element #${index}; checkVisibility=${save.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })}`;
}));
browser.disconnect();
