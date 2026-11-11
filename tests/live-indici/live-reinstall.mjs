// After a new build: copy dist to the test copy and (re)install it in the logged-in window — the login stays.
import puppeteer from 'puppeteer';
import { join } from 'node:path';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// DIST=<path>: another build (a before/after comparison).
const DIST = process.env.DIST ?? join(import.meta.dirname, '..', '..', 'dist');
const COPY = 'C:/Users/92313/.webagent-ext';
const b = await puppeteer.connect({ browserWSEndpoint: readFileSync(join(import.meta.dirname, '..', 'indici-live', 'indici-ws.txt'), 'utf8').trim(), defaultViewport: null });
const idFile = join(import.meta.dirname, '..', 'indici-live', 'ext-id.txt');
const old = existsSync(idFile) ? readFileSync(idFile, 'utf8').trim() : '';
if (old && old !== 'blhiljoicnofbjihhkpffchgpnpmnddi') await b.uninstallExtension(old).catch((e) => console.log('uninstall:', e.message));
rmSync(COPY, { recursive: true, force: true });
cpSync(DIST, COPY, { recursive: true });
const id = await b.installExtension(COPY);
writeFileSync(idFile, id);
console.log('installed', id);
b.disconnect();
