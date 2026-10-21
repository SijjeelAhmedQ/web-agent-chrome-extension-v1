// Runs the Web Agent's content script (dist/content.js, freshly built) on the live Indici tab, in an
// isolated world of its own — the page's scripts never see it — and sends it requests like the agent does.
import { readFileSync } from 'node:fs';
import { connect } from './indici-live.mjs';

const CONTENT = "D:/learing AI after Movement in Syed Ammar's Team/web-agent-chrome-extension/dist/content.js";

export async function contentScript() {
  const { browser, page } = await connect();
  const cdp = await page.createCDPSession();
  const { frameTree } = await cdp.send('Page.getFrameTree');
  const { executionContextId } = await cdp.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: `web-agent-test-${Date.now()}`, grantUniveralAccess: true });
  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, contextId: executionContextId, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  await evaluate(`globalThis.chrome = { runtime: { onMessage: { addListener(fn) { globalThis.__wa = fn; } } } }; ${readFileSync(CONTENT, 'utf8')}; true`);
  const send = (request) => evaluate(`new Promise((done) => globalThis.__wa({ channel: 'web-agent/v1', request: ${JSON.stringify(request)} }, {}, done))`).then((r) => {
    if (!r?.ok) throw new Error(JSON.stringify(r?.error ?? r));
    return r.data;
  });
  return { browser, page, send, close: async () => { await cdp.detach().catch(() => {}); browser.disconnect(); } };
}
