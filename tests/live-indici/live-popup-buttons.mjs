// The open pop-ups on the live page and their buttons, as the DOM has them (read only), and a picture.
//   TAB=inbox-app node live-popup-buttons.mjs
import { join } from 'node:path';
import { connect, DIR } from './indici-live.mjs';
const { browser, page } = await connect();
try {
  const found = await page.evaluate(() => {
    const shown = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const boxes = [...document.querySelectorAll('[role=dialog], .ant-modal, .ant-drawer, dialog, [aria-modal=true]')].filter(shown);
    return boxes.map((d) => ({
      tag: d.tagName.toLowerCase(),
      cls: String(d.className).slice(0, 80),
      title: (d.querySelector('.ant-modal-title, .ant-drawer-title, h1, h2, h3')?.textContent ?? '').trim().slice(0, 60),
      buttons: [...d.querySelectorAll('button, [role=button]')]
        .filter(shown)
        .map((b) => {
          const r = b.getBoundingClientRect();
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return `${(b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 30)} [${b.tagName.toLowerCase()}${b.disabled ? ' disabled' : ''}${top && top !== b && !b.contains(top) ? ` covered by ${top.tagName.toLowerCase()}.${String(top.className).slice(0, 40)}` : ''}]`;
        }),
    }));
  });
  console.log(JSON.stringify(found, null, 1));
  await page.screenshot({ path: join(DIR, 'captures', 'popup-buttons.png') });
  console.log('picture: captures/popup-buttons.png');
} finally {
  browser.disconnect();
}
