// areaText on the live Smart Inbox: the record showing, its rows and its list entry (read only).
//   TAB=inbox-app node live-area.mjs "Go to Consult" Next
import { contentScript } from './live-cs.mjs';
const cs = await contentScript();
try {
  const r = await cs.send({ kind: 'areaText', anchor: process.argv[2] ?? 'Go to Consult', next: process.argv[3] ?? 'Next' });
  console.log('list item:', JSON.stringify(r?.listItem), '· next', r?.nextId);
  for (const row of r?.rows ?? []) console.log('  ', row.cells.join(' | '));
} finally { await cs.close(); }
