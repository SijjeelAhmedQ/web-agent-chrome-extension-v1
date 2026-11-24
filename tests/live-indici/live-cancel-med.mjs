// Presses the Cancel beside the open medication form's Save (the unsaved form is dropped).
import { contentScript } from './live-cs.mjs';
const cs = await contentScript();
try {
  const { matches } = await cs.send({ kind: 'find', query: 'Cancel', limit: 10 });
  for (const m of matches) console.log(m.id, m.role, JSON.stringify(m.name), m.context ?? '');
  const c = matches.find((m) => /^cancel$/i.test(m.name) && !m.context);
  if (c && process.argv[2] === 'go') console.log('clicked', JSON.stringify(await cs.send({ kind: 'click', id: c.id, highlight: false })).slice(0, 120));
} finally { await cs.close(); }
