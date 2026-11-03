// Adds lab tests to the inbox record open in Indici's "Inbox" pop-up — test data, no model. Each test:
// "Click to add test", the name picked from the site's own list, a result, a status, Save.
//   TESTS='[{"test":"Haemoglobin blood","result":"128 g/L","status":"Normal"}]' node live-labtest.mjs
import { connect } from './indici-live.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tests = JSON.parse(process.env.TESTS ?? '[]');
const { browser, page } = await connect();

// A visible button or link with exactly this text, inside the pop-up whose text includes `within`.
async function control(text, within) {
  const h = await page.evaluateHandle(
    (text, within) => {
      const boxes = [...document.querySelectorAll('.modal.show')].filter((m) => !within || m.innerText.includes(within));
      for (const m of boxes.reverse()) {
        const el = [...m.querySelectorAll('button, a, input[type=button]')].find((x) => x.offsetParent && (x.innerText || x.value || '').trim() === text);
        if (el) return el;
      }
      return null;
    },
    text,
    within,
  );
  const el = h.asElement();
  if (!el) throw new Error(`no “${text}”${within ? ` in “${within}”` : ''}`);
  return el;
}

async function typeInto(selector, text) {
  await page.evaluate((s) => (document.querySelector(s).value = ''), selector);
  await page.click(selector);
  await page.keyboard.type(text, { delay: 25 });
}

try {
  for (const t of tests) {
    await (await control('Click to add test')).click();
    await sleep(2000);
    // Typed slowly and not to the end: the site's list answers a part of the name, and late answers replace early ones.
    await page.evaluate(() => (document.querySelector('#LabTests').value = ''));
    await page.click('#LabTests');
    await page.keyboard.type(t.typed ?? t.test.slice(0, Math.max(4, t.test.length - 2)), { delay: 150 });
    let li = null;
    for (let i = 0; i < 12 && !li; i++) {
      await sleep(500);
      li = (await page.evaluateHandle((name) => [...document.querySelectorAll('ul.ui-autocomplete li')].find((x) => x.offsetParent && x.innerText.trim() === name) ?? null, t.test)).asElement();
    }
    if (!li) throw new Error(`“${t.test}” is not in the site's test list`);
    await li.click();
    await sleep(800);
    await typeInto('#Result', t.result);
    const value = await page.evaluate((label) => [...document.querySelector('#Status').options].find((o) => o.text.trim() === label)?.value, t.status);
    if (!value) throw new Error(`no status “${t.status}”`);
    await page.select('#Status', value);
    await (await control('Save', 'Add lab Test')).click();
    await sleep(3500);
    const shown = await page.evaluate((name) => [...document.querySelectorAll('.modal.show')].some((m) => !m.innerText.includes('Add lab Test') && m.innerText.includes(name)), t.test);
    console.log(`${t.test}: ${t.result} (${t.status}) — ${shown ? 'added' : 'NOT shown in the record'}`);
  }
  // OK=1: then save the record itself — its OK, in the record's own pop-up.
  if (process.env.OK) {
    const saved = new Promise((done) => page.on('request', (r) => r.method() === 'POST' && /Inbox\/(LabMessage|InboxFolder)/.test(r.url()) && done(true)));
    const ok = (await page.evaluateHandle(() => {
      const m = [...document.querySelectorAll('.modal.show')].find((x) => x.innerText.includes('Name:') && x.innerText.includes('Create Referral'));
      return m ? [...m.querySelectorAll('button')].find((b) => b.innerText.trim() === 'OK' && b.offsetParent) ?? null : null;
    })).asElement();
    if (!ok) throw new Error('no OK in the record pop-up');
    await ok.click();
    console.log(await Promise.race([saved.then(() => 'record saved'), sleep(10000).then(() => 'record NOT saved (no request)')]));
    await sleep(3000);
  }
} finally {
  browser.disconnect();
}
