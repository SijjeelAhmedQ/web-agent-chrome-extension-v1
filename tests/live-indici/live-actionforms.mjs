// Opens each item of a menu (e.g. Actions › Create Task), prints the pop-up and its form fields, then closes it
// with its Cancel / × (nothing saved).   TAB=inbox-app node live-actionforms.mjs Actions "Create Task" …
import { contentScript } from './live-cs.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [menu, ...items] = process.argv.slice(2);
const cs = await contentScript();
const press = async (name, within) => {
  const { matches } = await cs.send({ kind: 'find', query: name, limit: 12 });
  const hit = matches.find((m) => m.name.trim().toLowerCase() === name.toLowerCase() && (!within || (m.context ?? '').includes(within))) ?? matches.find((m) => m.name.trim().toLowerCase() === name.toLowerCase());
  if (!hit) return false;
  await cs.send({ kind: 'click', id: hit.id, highlight: false });
  return true;
};
try {
  for (const item of items) {
    await press(menu);
    await sleep(800);
    if (!(await press(item))) { console.log(`### ${item}: not in the menu`); await cs.send({ kind: 'key', key: 'Escape' }); continue; }
    await sleep(2500);
    const { dialogs } = await cs.send({ kind: 'dialogs', waitMs: 500 });
    const d = dialogs[0];
    console.log(`\n### ${item}: ${d ? `pop-up “${d.title}”` : 'no pop-up'}`);
    if (d?.form?.length) console.log(d.form.join('\n'));
    else if (d) console.log(String(d.fullText ?? d.text).replace(/\s+/g, ' ').slice(0, 900));
    // Close without saving: its Cancel, else its ×, else Escape.
    if (!(d && ((await press('Cancel', 'dialog')) || (d.close && (await cs.send({ kind: 'click', id: d.close.id, highlight: false }), true))))) await cs.send({ kind: 'key', key: 'Escape' });
    await sleep(1200);
    const after = await cs.send({ kind: 'dialogs', waitMs: 300 });
    if (after.dialogs.length) console.log(`  (still open: ${after.dialogs.map((x) => x.title).join(', ')})`);
  }
} finally { await cs.close(); }
