// Joins the Chrome window the user logged in to (indici-browser.mjs) — read-only helpers.
import puppeteer from 'puppeteer';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const DIR = join(import.meta.dirname, '..', 'indici-live');
export const CAP = join(DIR, 'captures');
mkdirSync(CAP, { recursive: true });

export async function connect() {
  const browser = await puppeteer.connect({ browserWSEndpoint: readFileSync(join(DIR, 'indici-ws.txt'), 'utf8').trim(), defaultViewport: null });
  const pages = await browser.pages();
  // The newest Indici tab (a consult opens in a tab of its own).
  const indici = pages.filter((p) => /vitonta\.com/.test(p.url()));
  // A consult tab when there is one (it is where the work happens), else the newest Indici tab.
  const page = indici.filter((p) => /accordionslider/.test(p.url())).at(-1) ?? indici.at(-1) ?? pages[0];
  await page.bringToFront();
  return { browser, page };
}

/** The page's HTML with same-origin frames written in, form values kept — and a screenshot. */
export async function capture(page, name) {
  const html = await page.evaluate(() => {
    // Values written into a copy — the live page is not touched.
    const keep = (from, to) => {
      const a = from.querySelectorAll('input,textarea,select');
      const b = to.querySelectorAll('input,textarea,select');
      a.forEach((f, i) => {
        const c = b[i];
        if (!c) return;
        if (f.type === 'checkbox' || f.type === 'radio') { if (f.checked) c.setAttribute('checked', ''); else c.removeAttribute('checked'); }
        else if (f.tagName === 'SELECT') Array.from(c.options).forEach((o, k) => (f.options[k]?.selected ? o.setAttribute('selected', '') : o.removeAttribute('selected')));
        else if (f.type !== 'password') c.setAttribute('value', f.value);
      });
    };
    const clone = document.documentElement.cloneNode(true);
    keep(document.documentElement, clone);
    const frames = document.querySelectorAll('iframe');
    clone.querySelectorAll('iframe').forEach((f, i) => {
      try {
        const doc = frames[i].contentDocument;
        if (doc?.body) {
          const body = doc.body.cloneNode(true);
          keep(doc.body, body);
          f.setAttribute('data-captured', '1');
          f.insertAdjacentHTML('afterend', `<!--FRAME ${frames[i].src}-->` + body.outerHTML + '<!--/FRAME-->');
        }
      } catch { f.setAttribute('data-blocked', '1'); }
    });
    clone.querySelectorAll('script').forEach((s) => s.remove());
    return '<!doctype html>\n' + clone.outerHTML;
  });
  writeFileSync(join(CAP, `${name}.html`), html);
  await page.screenshot({ path: join(CAP, `${name}.png`) });
  return html.length;
}

/** What a person sees: visible pop-ups, and the controls in the one in front. */
export async function overview(page) {
  return page.evaluate(() => {
    const vis = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length) && getComputedStyle(e).visibility !== 'hidden';
    const dialogs = [...document.querySelectorAll('dialog[open],[role=dialog],.modal,.k-window,.ui-dialog')].filter(vis).map((d) => ({ cls: d.className.slice(0, 60), title: (d.querySelector('.modal-title,.k-window-title,.ui-dialog-title,h4,h3')?.textContent ?? '').trim().slice(0, 60), iframes: d.querySelectorAll('iframe').length }));
    return { url: location.href, title: document.title, dialogs, iframes: [...document.querySelectorAll('iframe')].filter(vis).map((f) => f.src.slice(0, 120)) };
  });
}
