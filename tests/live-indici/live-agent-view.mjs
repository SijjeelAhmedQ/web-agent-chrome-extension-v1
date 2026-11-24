// What the Web Agent's content script reads on the live Indici tab (read-only): its snapshot and,
// optionally, find_element results — node live-agent-view.mjs [find query]
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIR } from './indici-live.mjs';

import { contentScript } from './live-cs.mjs';
const cs = await contentScript();
try {
  const query = process.argv[2] ?? '';
  const res = { snap: await cs.send({ kind: 'snapshot', mode: 'overview', maxElements: 250, maxTextChars: 3000 }), find: query ? await cs.send({ kind: 'find', query, limit: 8 }) : null };
  writeFileSync(join(DIR, 'captures', 'agent-view.json'), JSON.stringify(res, null, 1));
  const s = res.snap;
  console.log('elements', s.elements.length, 'omitted', s.omitted, 'dialogs', (s.dialogs ?? []).map((d) => d.title));
  const d = s.dialogs?.[0];
  if (d) {
    console.log('FRONT', JSON.stringify(d.title), 'close', d.close?.name, 'form lines', d.form?.length ?? 0);
    console.log((d.form ?? []).join('\n'));
    console.log('--- elements in the dialog:');
    console.log(s.elements.filter((e) => /^dialog/.test(e.context ?? '')).map((e) => `[${e.id}] ${e.role} "${e.name}"${e.label ? ` label "${e.label}"` : ''}${e.value !== undefined ? ` value="${e.value}"` : ''}`).join('\n'));
  }
  if (res.find) console.log('--- find', JSON.stringify(query), '\n' + res.find.matches.map((e) => `[${e.id}] ${e.role} "${e.name}" ${e.context ?? ''}`).join('\n'));
} finally {
  await cs.close();
}
