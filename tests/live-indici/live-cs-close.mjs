// Opens the Smart Inbox's Clinical Summary for the open patient and closes it with its own buttons, as the agent
// does — to see which of them closes it (read only: nothing in it saves).
//   TAB=inbox-app node live-cs-close.mjs
import { contentScript } from './live-cs.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cs = await contentScript();
const named = async (q) => (await cs.send({ kind: 'find', query: q, limit: 12 })).matches.filter((m) => m.name.trim().toLowerCase() === q.toLowerCase());
const dialogs = async () => (await cs.send({ kind: 'dialogs', waitMs: 300 })).dialogs.map((d) => `${d.title}${d.close ? ` (close: ${d.close.name || d.close.role})` : ''}`);
try {
  const open = (await named('Clinical Summary'))[0];
  if (!open) throw new Error('no Clinical Summary button');
  await cs.send({ kind: 'click', id: open.id, highlight: false });
  await sleep(2500);
  console.log('after opening:', await dialogs());
  if (process.env.TAB_FIRST) { const t = (await named(process.env.TAB_FIRST))[0]; if (t) { await cs.send({ kind: 'click', id: t.id, highlight: false }); await sleep(2500); console.log('opened tab', process.env.TAB_FIRST); } }
  for (const name of ['Close', 'Back to List']) {
    const hits = await named(name);
    console.log(`${name}:`, hits.map((h) => `[${h.id}] ${h.role} ${h.context ?? ''}`).join(' | ') || 'none');
    if (!hits.length) continue;
    await cs.send({ kind: 'click', id: hits[0].id, highlight: process.env.HIGHLIGHT === '1' });
    await sleep(1500);
    console.log(`after ${name}:`, await dialogs());
    if (!(await dialogs()).some((d) => /clinical/i.test(d))) break;
  }
} finally {
  await cs.close();
}
