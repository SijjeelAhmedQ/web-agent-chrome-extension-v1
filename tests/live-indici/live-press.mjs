// Presses a control by its exact name, optionally only within a context (dialog “Add Task”):
//   node live-press.mjs Cancel "Add Task"
import { contentScript } from './live-cs.mjs';
const [name, within = ''] = process.argv.slice(2);
const cs = await contentScript();
try {
  const { matches } = await cs.send({ kind: 'find', query: name, limit: 15 });
  const hit = matches.find((m) => m.name.trim().toLowerCase() === name.toLowerCase() && (m.context ?? '').includes(within));
  if (!hit) { console.log('not found; saw:', matches.map((m) => `${m.name} ${m.context ?? ''}`).join(' | ')); process.exit(1); }
  console.log('pressing', hit.id, hit.role, JSON.stringify(hit.name), hit.context ?? '');
  await cs.send({ kind: 'click', id: hit.id, highlight: false });
} finally { await cs.close(); }
