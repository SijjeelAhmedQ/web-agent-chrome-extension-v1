// Does Due follow Due-in after the agent types it, and after a Tab out of the field?
import { contentScript } from './live-cs.mjs';
const cs = await contentScript();
try {
  const due = () => cs.page.$eval('#LargePopupModel_Tasks #EndDate', (e) => e.value);
  const snap = await cs.send({ kind: 'snapshot', mode: 'overview', maxElements: 250, maxTextChars: 300 });
  const dueIn = snap.elements.find((e) => e.name === 'Due-in' && /^dialog/.test(e.context ?? ''));
  console.log('Due before', await due());
  await cs.send({ kind: 'type', id: dueIn.id, text: '3 Week(s)', clear: true, highlight: false });
  await new Promise((r) => setTimeout(r, 800));
  console.log('Due after typing "3 Week(s)"', await due());
  await cs.send({ kind: 'key', key: 'Tab', id: dueIn.id });
  await new Promise((r) => setTimeout(r, 1200));
  console.log('Due after Tab', await due());
} finally { await cs.close(); }
