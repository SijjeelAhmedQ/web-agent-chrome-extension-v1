// read_table on the live page with the new content script.
import { contentScript } from './live-cs.mjs';
const cs = await contentScript();
try {
  const t = await cs.send({ kind: 'table', near: process.argv[2] ?? '', max: 30 });
  console.log(t.headers.join(' | '));
  for (const r of t.rows) console.log(r.cells.join(' | '), '—', r.colour);
} finally { await cs.close(); }
