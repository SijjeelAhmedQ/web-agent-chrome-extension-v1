// Walks a patient's records in the Smart Inbox with "Next" and prints what each shows (read only — the app marks them read).
//   TAB=inbox-app node live-recordwalk.mjs "Arya STARK. Abnormal" 6
import { connect } from './indici-live.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [patient, n = '6'] = process.argv.slice(2);
const { browser, page } = await connect();
try {
  const clickByText = (t) => page.evaluate((t) => { const b = [...document.querySelectorAll('button,[role=button]')].find((x) => (x.getAttribute('aria-label') || x.textContent || '').trim() === t); b?.click(); return !!b; }, t);
  console.log('open patient:', await clickByText(patient));
  await sleep(2500);
  for (let i = 0; i < Number(n); i++) {
    const s = await page.evaluate(() => {
      const pos = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && /^\d+ \/ \d+$/.test(e.textContent.trim()))?.textContent.trim();
      const head = document.querySelector('a[href*=consult], button[aria-label^="Go to Consult"]')?.getAttribute('aria-label') ?? '';
      const table = [...document.querySelectorAll('table')].map((t) => t.innerText.replace(/\s+/g, ' ').slice(0, 300)).join(' || ');
      const tag = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && /^(LAB|RAD|REFERRALS|DISCHARGE)$/.test(e.textContent.trim()))?.textContent.trim();
      const next = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Next');
      return { pos, head, tag, table: table || document.body.innerText.match(/Document[\s\S]{0,120}/)?.[0]?.replace(/\s+/g, ' '), nextDisabled: next ? next.disabled : null };
    });
    console.log(`${i + 1}. ${s.pos} · ${s.head} · ${s.tag} · next disabled=${s.nextDisabled}\n   ${s.table}`);
    if (s.nextDisabled !== false) break;
    await clickByText('Next');
    await sleep(2500);
  }
} finally { browser.disconnect(); }
