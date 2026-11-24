// The Smart Inbox's record table and the patient list's record buttons, with their colours — to tell
// abnormal records that have no STATUS column (read only).
//   TAB=inbox-app node live-colours.mjs
import { connect } from './indici-live.mjs';
const { browser, page } = await connect();
try {
  console.log(JSON.stringify(await page.evaluate(() => {
    const col = (e) => getComputedStyle(e).color;
    const tables = [...document.querySelectorAll('table')].map((t) => [...t.rows].map((r) => [...r.cells].map((c) => `${c.innerText.trim()} {${col(c.querySelector('*') ?? c)}}`).join(' | ')));
    const pos = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && /^\d+ \/ \d+$/.test(e.textContent.trim()))?.textContent.trim();
    const records = [...document.querySelectorAll('button,[role=button]')].filter((b) => /\d\d\/\d\d\/\d{4}$/.test(b.textContent.trim()) && b.textContent.trim().length < 80).map((b) => `${b.textContent.trim()} {${col(b)}; ${[...b.querySelectorAll('*')].map(col).join(',')}}`);
    return { pos, tables, records };
  }), null, 1));
} finally { browser.disconnect(); }
