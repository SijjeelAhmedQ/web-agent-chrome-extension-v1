// select_option on a live Ant Design form: opens a menu item's form (e.g. Actions › Create Recall), chooses
// each "Field=Option", prints the form, then closes it with Close / Cancel — nothing is saved.
//   TAB=inbox-app node live-antselect.mjs "Create Recall" "Provider=Chadmin CHADMIN" "Recall Group=Bloods" "Description=CBC"
import { contentScript } from './live-cs.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [item, ...pairs] = process.argv.slice(2);
const cs = await contentScript();
const find = async (q) => (await cs.send({ kind: 'find', query: q, limit: 12 })).matches;
const press = async (q) => {
  const hit = (await find(q)).find((m) => m.name.trim().toLowerCase() === q.toLowerCase());
  if (hit) await cs.send({ kind: 'click', id: hit.id, highlight: false });
  await sleep(1500);
  return !!hit;
};
try {
  await press('Actions');
  console.log('opened:', await press(item));
  for (const pair of pairs) {
    const [field, option] = pair.split('=');
    const target = (await find(field)).find((m) => /combobox|select|textbox/.test(m.role) && m.name.toLowerCase().includes(field.toLowerCase()));
    if (!target) { console.log(`${field}: not found`); continue; }
    try {
      const r = await cs.send({ kind: 'select', id: target.id, option, highlight: false });
      console.log(`${field} → ${r.selected}`);
    } catch (err) {
      console.log(`${field}: ${err.message.slice(0, 300)}`);
    }
    await sleep(500);
  }
  // What an approval card for its Save would show.
  const save = (await find('Save')).find((m) => m.name.trim() === 'Save');
  if (save) console.log('approval card fields:', JSON.stringify((await cs.send({ kind: 'describe', id: save.id })).formValues));
  const { dialogs } = await cs.send({ kind: 'dialogs', waitMs: 800 });
  console.log('form now:', (dialogs[0]?.fullText ?? '').split('\n')[0].slice(0, 500));
} finally {
  const { dialogs } = await cs.send({ kind: 'dialogs', waitMs: 300 }).catch(() => ({ dialogs: [] }));
  if (dialogs[0]?.close) await cs.send({ kind: 'click', id: dialogs[0].close.id, highlight: false }).catch(() => {});
  else await press('Close');
  await cs.close();
}
