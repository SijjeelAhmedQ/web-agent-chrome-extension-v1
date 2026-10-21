import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless: true });
const p = await b.newPage();
await p.goto('http://localhost:4599/legacy.html?plain=1');
console.log(await p.evaluate(() => {
  const v = (e) => e.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const $ = (e, n) => ` ${v(e)} `.includes(` ${n} `);
  const o = v('Arya STARK');
  const s = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  const log = [];
  const a = () => { let u = s.nextSibling(); for (; !u && s.parentNode(); ) u = s.nextSibling(); return u; };
  let c = s.firstChild();
  for (let u = 0; c && u < 200; u++) {
    const has = $(c.textContent ?? '', o);
    log.push(`${c.tagName}${c.className ? '.' + c.className : ''}:${has ? 'Y' : 'n'}`);
    if (!has) { c = a(); continue; }
    c = s.nextNode();
  }
  return log.join(' ');
}));
await b.close();
