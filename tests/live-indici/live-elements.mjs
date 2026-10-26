// The elements the agent's content script lists on a live tab, one per line: TAB=inbox-app node live-elements.mjs [max]
import { contentScript } from './live-cs.mjs';
const cs = await contentScript();
try {
  const snap = await cs.send({ kind: 'snapshot', mode: 'overview', maxElements: Number(process.argv[2] ?? 300), maxTextChars: 2000 });
  console.log(`Page: ${snap.title} · ${snap.elements.length} listed, ${snap.omitted} more`);
  for (const d of snap.dialogs ?? []) console.log(`POP-UP “${d.title}” close=${d.close?.name ?? '—'}`);
  for (const e of snap.elements) console.log(`[${e.id}] ${e.role} "${e.name}"${e.value ? ` = “${String(e.value).slice(0, 40)}”` : ''}${e.context ? ` · ${e.context.slice(0, 70)}` : ''}${e.inViewport ? '' : ' ↓'}`);
} finally { await cs.close(); }
