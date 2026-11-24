// The pop-ups on the live page, as the agent's content script reads them: node live-dialogs.mjs
import { contentScript } from './live-cs.mjs';
const cs = await contentScript();
try {
  const { dialogs } = await cs.send({ kind: 'dialogs', waitMs: 500 });
  for (const d of dialogs) console.log(`- “${d.title}” close=${d.close ? d.close.name : '—'} · ${String(d.text ?? '').replace(/\s+/g, ' ').slice(0, 300)}`);
} finally { await cs.close(); }
