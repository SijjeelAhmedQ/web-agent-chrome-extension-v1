import { connect, capture, overview } from './indici-live.mjs';
const { browser, page } = await connect();
console.log(JSON.stringify(await overview(page)));
console.log('captured', await capture(page, process.argv[2] ?? 'dashboard'));
browser.disconnect();
