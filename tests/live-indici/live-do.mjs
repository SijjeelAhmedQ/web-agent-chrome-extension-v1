// Runs read-only steps in the logged-in Indici window: node live-do.mjs '<json steps>'
// Steps: {"click":"text"} {"near":"row text"} {"type":["css selector","text"]} {"key":"Enter"}
//        {"wait":ms} {"capture":"name"} {"sel":"css selector to click"} {"look":true}
// Buttons that change records are refused here.
import { connect, capture, overview } from './indici-live.mjs';

const WRITES = /^(save|file|un ?file|ok|complete|delete|remove|submit|send|post|confirm|yes|finali[sz]e|sign|print)$/i;
const steps = JSON.parse(process.argv[2]);
const { browser, page } = await connect();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  for (const s of steps) {
    if (s.click) {
      if (WRITES.test(s.click.trim())) throw new Error(`refused: “${s.click}” changes records`);
      const ok = await page.evaluate((text, near) => {
        const vis = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length) && getComputedStyle(e).visibility !== 'hidden';
        const norm = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
        const all = [...document.querySelectorAll('a,button,input[type=button],input[type=submit],span,td,li,div,label,i')].filter(vis);
        const hit = all.filter((e) => norm(e.innerText || e.value) === text && (!near || norm(e.closest('tr,li,.row,div')?.innerText).includes(near)));
        const el = hit.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length)[0];
        if (!el) return false;
        el.scrollIntoView({ block: 'center' });
        el.click();
        return true;
      }, s.click, s.near ?? '');
      console.log(`click “${s.click}”`, ok ? 'ok' : 'NOT FOUND');
      await sleep(s.after ?? 2500);
    } else if (s.write) {
      // A write the user allowed by name (e.g. the "Add reason to view patient file" Save): one exact control.
      const el = await page.$(s.write);
      if (!el) { console.log('write', s.write, 'NOT FOUND'); continue; }
      await el.click();
      console.log('WRITE (allowed by the user):', s.write);
      await sleep(s.after ?? 3000);
    } else if (s.sel) {
      const el = await page.$(s.sel);
      if (!el) { console.log('sel', s.sel, 'NOT FOUND'); continue; }
      // The element's own click — a fixed header may cover where a mouse would land.
      await page.evaluate((e) => { e.scrollIntoView({ block: 'center' }); e.click(); }, el);
      console.log('sel', s.sel, 'ok');
      await sleep(s.after ?? 2500);
    } else if (s.type) {
      const el = await page.$(s.type[0]);
      if (!el) { console.log('type target', s.type[0], 'NOT FOUND'); continue; }
      await el.click({ clickCount: 3 });
      await el.type(s.type[1], { delay: 40 });
      console.log('typed', s.type[1]);
      await sleep(s.after ?? 1500);
    } else if (s.key) {
      await page.keyboard.press(s.key);
      await sleep(s.after ?? 1500);
    } else if (s.wait) await sleep(s.wait);
    else if (s.capture) console.log('captured', s.capture, await capture(page, s.capture));
    else if (s.look) console.log(JSON.stringify(await overview(page)));
  }
} finally {
  browser.disconnect();
}
