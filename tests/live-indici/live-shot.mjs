// A picture of the live Indici tab: node live-shot.mjs out.png
import { connect } from './indici-live.mjs';
const { browser, page } = await connect();
await page.screenshot({ path: process.argv[2] ?? '../indici-live/captures/site.png' });
browser.disconnect();
