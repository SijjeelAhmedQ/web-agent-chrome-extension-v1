// The icons the agent sees with their new bar context (live page, new content script).
import { contentScript } from './live-cs.mjs';
const cs = await contentScript();
try {
  const snap = await cs.send({ kind: 'snapshot', mode: 'overview', maxElements: 400, maxTextChars: 200 });
  console.log(snap.elements.filter((e) => /\(icon\)|Refresh|Print|Complete|Add New Task/.test(e.name + e.context) && /Records|Compact/.test(e.context ?? '')).slice(0, 25).map((e) => `[${e.id}] ${e.role} "${e.name}" ${e.context}`).join('\n'));
} finally { await cs.close(); }
