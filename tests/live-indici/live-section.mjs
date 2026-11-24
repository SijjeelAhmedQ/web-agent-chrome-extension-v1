// Opens a consult section from the left sidebar (Medications, Task, Recall…) and prints a list on it.
//   node live-section.mjs Medications "paracetamol"
import { contentScript } from './live-cs.mjs';
const [section, near = ''] = process.argv.slice(2);
const cs = await contentScript();
try {
  const { matches } = await cs.send({ kind: 'find', query: section, limit: 10 });
  const link = matches.find((m) => m.name.trim().toLowerCase() === section.toLowerCase() && /link|clickable/.test(m.role)) ?? matches[0];
  console.log('clicking', link.id, link.role, JSON.stringify(link.name), link.context ?? '');
  await cs.send({ kind: 'click', id: link.id, highlight: false });
  await new Promise((r) => setTimeout(r, 4000));
  const t = await cs.send({ kind: 'table', near, max: 40 });
  console.log(t.headers.join(' | '));
  for (const r of t.rows) console.log(r.cells.join(' | ').slice(0, 220), '—', r.colour);
} finally { await cs.close(); }
