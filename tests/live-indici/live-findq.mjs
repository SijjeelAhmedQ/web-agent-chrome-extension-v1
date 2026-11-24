// find_element on the live page: node live-findq.mjs "<query>"
import { contentScript } from './live-cs.mjs';
const cs = await contentScript();
try {
  const { matches, textMatches } = await cs.send({ kind: 'find', query: process.argv[2], limit: 12 });
  for (const m of matches) console.log(m.id, m.role, JSON.stringify(m.name), JSON.stringify(m.value ?? ''), m.context ?? '', m.required ? 'required' : '');
  if (textMatches?.length) console.log('text:', textMatches.slice(0, 5));
} finally { await cs.close(); }
