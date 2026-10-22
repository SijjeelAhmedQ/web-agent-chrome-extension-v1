// Opens a Chrome window (with the Web Agent extension) on the Indici training site and keeps it open.
// The user logs in there once, by hand (reCAPTCHA / MFA); other scripts connect to this same browser
// through the address written to indici-ws.txt — no password is ever stored or typed by a script.
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const EXT = process.argv[2];
const DIR = join(import.meta.dirname, '..', 'indici-live');
mkdirSync(DIR, { recursive: true });
// Extensions installed through the browser's own channel (not a command-line flag) can be reinstalled
// after each build without closing the window — the login stays.
const browser = await puppeteer.launch({
  headless: false,
  defaultViewport: null,
  // A short path: Chrome's extension storage fails past Windows' 260-character limit.
  userDataDir: 'C:/Users/92313/.webagent-indici-profile',
  enableExtensions: true,
  args: ['--start-maximized'],
});
const extId = await browser.installExtension(EXT);
writeFileSync(join(DIR, 'indici-ws.txt'), browser.wsEndpoint());
writeFileSync(join(DIR, 'ext-id.txt'), extId);
console.log('EXTENSION', extId);
// A blank tab that always stays: closing the Indici tabs never closes the window (and the login).
const keeper = (await browser.pages())[0] ?? (await browser.newPage());
await keeper.goto('about:blank');
const page = await browser.newPage();
await page.goto('https://pmstraining.vitonta.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
console.log('OPEN — waiting for the user to log in');
for (;;) {
  const pages = await browser.pages();
  const titles = await Promise.all(pages.map((p) => p.title().catch(() => '')));
  if (titles.some((t) => t && t !== 'Login' && !/^about:|^$/.test(t)) && pages.some((p) => /vitonta\.com/.test(p.url()) && !/\/(Account\/)?Login/i.test(p.url()) && p.url() !== 'https://pmstraining.vitonta.com/')) {
    console.log('LOGGED IN', titles.filter(Boolean).join(' | '));
    break;
  }
  await new Promise((r) => setTimeout(r, 2000));
}
// Stay open: the session lives in this browser.
await new Promise(() => {});
