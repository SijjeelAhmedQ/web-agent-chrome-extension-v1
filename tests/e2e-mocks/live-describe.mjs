// The approval's details for the Add Task Save, as the new content script reads them on the live form.
import { contentScript } from './live-cs.mjs';
const cs = await contentScript();
try {
  const snap = await cs.send({ kind: 'snapshot', mode: 'overview', maxElements: 250, maxTextChars: 300 });
  const save = snap.elements.find((e) => e.name === 'Save' && /^dialog/.test(e.context ?? ''));
  const info = await cs.send({ kind: 'describe', id: save.id });
  console.log('buttons:', info.formActions.map((a) => a.name).join(' · '), '| shown:', info.shown);
  for (const f of info.formValues) console.log(`  ${f.label}: ${f.value}`);
} finally { await cs.close(); }
