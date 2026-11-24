// An AI card's Full Form, as the agent fills it: presses the card's Add button (the card whose text holds
// `cardText`), then Full Form, chooses each "Field=Option", and prints what the Save's approval card would show
// and which pop-ups are open. Then Close and Cancel — nothing is saved.
// A "Field~text" pair types into that field instead.
//   TAB=inbox-app node live-aifullform.mjs "Serial FBCs" "Add recall" "Description=CBC" "Recall In=3 Month(s)" "Notes~[web agent test]"
import { contentScript } from './live-cs.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [cardText, button, ...pairs] = process.argv.slice(2);
const cs = await contentScript();
const find = async (q) => (await cs.send({ kind: 'find', query: q, limit: 20 })).matches;
try {
  // The card's own Add button: the one whose row or bar holds the card's text.
  const adds = (await find(button)).filter((m) => m.name.trim().toLowerCase() === button.toLowerCase());
  const add = adds.find((m) => (m.context ?? '').includes(cardText)) ?? adds[0];
  if (add) {
    await cs.send({ kind: 'click', id: add.id, highlight: false });
    await sleep(1500);
  }
  const full = (await find('Full Form')).find((m) => m.name === 'Full Form');
  console.log('full form button:', !!full);
  if (full) await cs.send({ kind: 'click', id: full.id, highlight: false });
  await sleep(2000);
  for (const pair of pairs) {
    if (pair.includes('~')) {
      const [field, text] = pair.split('~');
      const box = (await find(field)).find((m) => m.role === 'textbox');
      const r = await cs.send({ kind: 'type', id: box.id, text, clear: true, highlight: false });
      await new Promise((ok) => setTimeout(ok, 1500));
      console.log(`${field} typed → ${r.value} · a moment later: ${(await cs.send({ kind: 'fieldText', id: box.id })).value}`);
      continue;
    }
    const [field, option] = pair.split('=');
    const target = (await find(field)).find((m) => /combobox|select/.test(m.role) || m.name.toLowerCase().includes(field.toLowerCase()));
    try {
      console.log(`${field} → ${(await cs.send({ kind: 'select', id: target.id, option, highlight: false })).selected}`);
    } catch (err) {
      console.log(`${field}: ${err.message.slice(0, 200)}`);
    }
    await sleep(400);
  }
  const saves = (await find('Save')).filter((m) => m.name.trim() === 'Save');
  for (const s of saves) console.log(`Save [${s.id}] ${s.context ?? ''} card fields:`, JSON.stringify((await cs.send({ kind: 'describe', id: s.id })).formValues));
  const { dialogs } = await cs.send({ kind: 'dialogs', waitMs: 500 });
  console.log('pop-ups:', dialogs.map((d) => d.title).join(' | '));
} finally {
  for (const name of ['Close', 'Cancel']) {
    const hit = (await find(name)).find((m) => m.name.trim() === name);
    if (hit) await cs.send({ kind: 'click', id: hit.id, highlight: false }).catch(() => {});
    await sleep(800);
  }
  await cs.close();
}
