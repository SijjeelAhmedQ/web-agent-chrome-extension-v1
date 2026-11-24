// Opens each Ant Design select whose shown text matches, with a real click, and prints its options.
//   TAB=inbox-app node live-selects.mjs "Status (All)" "AI (All)" …
import { connect } from './indici-live.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { browser, page } = await connect();
try {
  for (const label of process.argv.slice(2)) {
    const box = await page.evaluate((label) => {
      const el = [...document.querySelectorAll('.ant-select')].find((s) => (s.innerText || '').replace(/\s+/g, ' ').trim().startsWith(label.replace(/ \(All\)$/, '')));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, label);
    if (!box) { console.log(`### ${label}: not found`); continue; }
    await page.mouse.click(box.x, box.y);
    await sleep(1200);
    const options = await page.evaluate(() => [...document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option, .ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-tree-title, .ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-tree-select-tree-title')].map((o) => o.textContent.trim()).filter(Boolean));
    console.log(`### ${label}: ${options.length} options — ${options.slice(0, 40).join(' | ')}`);
    await page.keyboard.press('Escape');
    await sleep(500);
  }
} finally { browser.disconnect(); }
