// Each listed record's Diagnostic Comment, in full (read only — opening a record marks it read in the app).
//   TAB=inbox-app node live-comments.mjs "[web agent test] inbox" "Testing" "Test Web Agent" "test result normal"
import { connect } from './indici-live.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const subjects = process.argv.slice(2);
const { browser, page } = await connect();
try {
  for (const subject of subjects) {
    const opened = await page.evaluate((s) => {
      const b = [...document.querySelectorAll('[role=button]')].find((x) => (x.innerText ?? '').trim().split('\n')[0].trim() === s);
      b?.click();
      return !!b;
    }, subject);
    await sleep(2500);
    const comment = await page.evaluate(() => document.querySelector('textarea[aria-label="Diagnostic Comment"]')?.value ?? null);
    console.log(`${subject}: ${opened ? JSON.stringify(comment) : 'not in the list'}`);
  }
} finally {
  browser.disconnect();
}
