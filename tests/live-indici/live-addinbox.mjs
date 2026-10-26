// Opens Indici's "Add to Patient Inbox" pop-up, prints its controls as the agent sees them, then presses its
// Cancel — nothing is saved.   TAB=pmstraining node live-addinbox.mjs
import { contentScript } from './live-cs.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cs = await contentScript();
try {
  const { matches } = await cs.send({ kind: 'find', query: 'Add to Patient Inbox', limit: 5 });
  await cs.send({ kind: 'click', id: matches[0].id, highlight: false });
  await sleep(2500);
  const snap = await cs.send({ kind: 'snapshot', mode: 'interactive', maxElements: 400, maxTextChars: 3000 });
  const els = (snap.elements ?? []).filter((e) => (e.context ?? '').includes('dialog') || e.inDialog);
  for (const e of els.length ? els : snap.elements.slice(0, 80)) console.log(`[${e.id}] ${e.role} "${e.name}" ${e.value ? `= ${e.value}` : ''} ${e.context ?? ''} ${e.required ? '(required)' : ''}`);
  console.log(JSON.stringify(await cs.page.evaluate(() => [...document.querySelectorAll('select')].filter((x) => x.offsetParent && x.closest('.modal, [role=dialog]')).map((x) => ({ name: x.name || x.id, options: [...x.options].map((o) => o.text.trim()).slice(0, 25), count: x.options.length })))));
  const cancel = (await cs.send({ kind: 'find', query: 'Cancel', limit: 8 })).matches.find((m) => m.name.trim() === 'Cancel');
  if (cancel) await cs.send({ kind: 'click', id: cancel.id, highlight: false });
  console.log('cancelled:', !!cancel);
} finally { await cs.close(); }
