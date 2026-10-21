import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  await page.goto('https://pmstraining.vitonta.com', { waitUntil: 'networkidle2', timeout: 60000 });
  console.log('URL', page.url(), 'TITLE', await page.title());
  console.log(JSON.stringify(await page.$$eval('input,button,select', (els) => els.map((e) => ({ tag: e.tagName, type: e.type, id: e.id, name: e.name, ph: e.placeholder, text: (e.innerText || e.value || '').slice(0, 40) })))));
  await page.screenshot({ path: process.argv[2] });
} finally { await browser.close(); }
