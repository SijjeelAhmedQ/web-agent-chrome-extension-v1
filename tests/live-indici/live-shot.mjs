// A picture of the live Indici tab: node live-shot.mjs out.png
import { connect } from './indici-live.mjs';
import { join } from 'node:path';
const { browser, page } = await connect();
await page.screenshot({ path: process.argv[2] ?? join(import.meta.dirname, '..', 'indici-live', 'captures/site.png') });
browser.disconnect();
