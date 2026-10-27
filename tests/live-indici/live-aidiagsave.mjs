// Saves one AI-suggested diagnosis through its Full Form, with a "[web agent test]" note, and watches what the
// page says for 20 s — to tell whether the app's save finishes. It SAVES (a test diagnosis on the patient).
//   TAB=inbox-app node live-aidiagsave.mjs "Dyslipidaemia" "[web agent test] diagnosis full form"
import { contentScript } from './live-cs.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [cardText, note] = process.argv.slice(2);
const cs = await contentScript();
const find = async (q) => (await cs.send({ kind: 'find', query: q, limit: 20 })).matches;
const said = async () => (await cs.page.evaluate(() => [...document.querySelectorAll('.ant-message-notice, .ant-notification-notice, [role=alert], [role=status]')].map((n) => n.innerText.trim()).filter(Boolean).join(' | ')));
try {
  const adds = (await find('Add diagnosis')).filter((m) => m.name.trim() === 'Add diagnosis');
  const add = adds.find((m) => (m.context ?? '').includes(cardText)) ?? adds[0];
  await cs.send({ kind: 'click', id: add.id, highlight: false });
  await sleep(1500);
  await cs.send({ kind: 'click', id: (await find('Full Form')).find((m) => m.name === 'Full Form').id, highlight: false });
  await sleep(2500);
  const notes = (await find('Notes')).find((m) => m.role === 'textbox' && /notes/i.test(m.name));
  if (notes) await cs.send({ kind: 'type', id: notes.id, text: note, clear: true, highlight: false });
  const save = (await find('Save')).find((m) => m.name.trim() === 'Save');
  console.log('saving with:', JSON.stringify((await cs.send({ kind: 'describe', id: save.id })).formValues));
  await cs.send({ kind: 'click', id: save.id, highlight: false });
  for (let t = 0; t < 10; t++) {
    await sleep(2000);
    const { dialogs } = await cs.send({ kind: 'dialogs', waitMs: 200 });
    console.log(`${(t + 1) * 2}s · pop-ups: ${dialogs.map((d) => d.title.slice(0, 30)).join(' | ') || 'none'} · messages: ${(await said()) || '—'}`);
    if (!dialogs.some((d) => /Diagnosis/i.test(d.title))) break;
  }
} finally {
  await cs.close();
}
