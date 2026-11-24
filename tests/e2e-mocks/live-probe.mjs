import { connect } from './indici-live.mjs';
const { browser, page } = await connect();
console.log(await page.evaluate(() => {
  const out = [];
  for (const e of document.querySelectorAll('input[type=button],input[type=submit],button,a')) {
    const t = (e.value || e.innerText || '').trim();
    if (!/^(Save|Reset|Cancel|Complete)$/.test(t)) continue;
    const r = e.getBoundingClientRect();
    if (!r.width) continue;
    const modal = e.closest('.modal');
    const dlg = e.closest('[role=dialog],.modal.show');
    out.push(`${e.tagName} id=${e.id} "${t}" @${Math.round(r.x)},${Math.round(r.y)} modal=${modal?.id} dialogMatch=${dlg?.id ?? '-'} class=${e.className.slice(0, 50)} display=${getComputedStyle(e).display} vis=${getComputedStyle(e).visibility} pe=${getComputedStyle(e).pointerEvents}`);
  }
  const front = [...document.querySelectorAll('.modal.show,[role=dialog]')].filter((d) => d.offsetWidth).map((d) => `${d.id} class=${d.className}`);
  return out.join('\n') + '\nVISIBLE MODALS: ' + front.join(' | ');
}));
browser.disconnect();
