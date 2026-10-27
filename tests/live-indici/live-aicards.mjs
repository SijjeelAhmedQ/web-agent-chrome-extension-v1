// The Smart Inbox's Patient AI Actions: opens a patient, then for each named card kind (ADD RECALL, ADD DIAGNOSIS…)
// presses its Add button, prints the quick edit, presses Full Form and prints that form, then cancels both.
// Nothing is created: no Create, no Save.   TAB=inbox-app node live-aicards.mjs "Aqib" "Add recall" "Add diagnosis"
import { contentScript } from './live-cs.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [patient, ...buttons] = process.argv.slice(2);
const cs = await contentScript();
const find = async (q, exact) => (await cs.send({ kind: 'find', query: q, limit: 12 })).matches.find((m) => m.name.trim().toLowerCase() === (exact ?? q).toLowerCase());
const press = async (q) => {
  const hit = await find(q);
  if (!hit) return false;
  await cs.send({ kind: 'click', id: hit.id, highlight: false });
  await sleep(1800);
  return true;
};
const fields = async (label) => {
  const snap = await cs.send({ kind: 'snapshot', mode: 'interactive', maxElements: 700, maxTextChars: 500 });
  const near = snap.elements.filter((e) => /QUICK EDIT|DETAILS|DUE DATE|PRIORITY|ASSIGN|LOCATION|RECALL|DIAGNOSIS/i.test(`${e.context ?? ''}`) || /^(Create|Full Form|Cancel|Done)$/.test(e.name));
  console.log(`--- ${label}`);
  for (const e of near.slice(0, 30)) console.log(`[${e.id}] ${e.role} "${e.name}"${e.value ? ` = ${e.value}` : ''} · ${e.context ?? ''}`);
};
try {
  if (patient) {
    const box = await find('Patient Name');
    await cs.send({ kind: 'type', id: box.id, text: patient, clear: true, highlight: false });
    await press('Search');
    await sleep(2500);
  }
  for (const button of buttons) {
    if (!(await press(button))) {
      console.log(`### ${button}: no such button`);
      continue;
    }
    await fields(`${button} — quick edit`);
    if (await press('Full Form')) {
      const { dialogs } = await cs.send({ kind: 'dialogs', waitMs: 1500 });
      console.log(`--- ${button} — Full Form pop-up “${dialogs[0]?.title ?? ''}”`);
      console.log((dialogs[0]?.fullText ?? dialogs[0]?.text ?? '').slice(0, 1500));
      const close = (await find('Close')) ?? (await find('Cancel'));
      if (close) await cs.send({ kind: 'click', id: close.id, highlight: false });
      await sleep(1200);
    }
    // Leave the quick edit without creating anything.
    await press('Cancel');
  }
} finally {
  await cs.close();
}
