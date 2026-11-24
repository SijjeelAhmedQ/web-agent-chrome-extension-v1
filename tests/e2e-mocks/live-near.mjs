// Controls on one line with a text (e.g. the task list's "Records 1 to 1 of 1"), as the agent names them.
import { contentScript } from './live-cs.mjs';
const cs = await contentScript();
try {
  const anchor = process.argv[2];
  const y = await cs.page.evaluate((t) => { const el = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim().startsWith(t) && e.offsetWidth); return el ? el.getBoundingClientRect().top : null; }, anchor);
  const snap = await cs.send({ kind: 'snapshot', mode: 'overview', maxElements: 400, maxTextChars: 200 });
  const near = await cs.page.evaluate(() => 0);
  console.log('anchor y', y);
  // describe each element near that line via find with its own name
  for (const e of snap.elements) {
    const r = await cs.send({ kind: 'describe', id: e.id }).catch(() => null);
    void r;
  }
  const lines = await cs.page.evaluate((y) => [...document.querySelectorAll('a,i,span,button,input')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && Math.abs(r.top - y) < 14 && r.left > 360 && r.left < 1100; }).map((e) => `${e.tagName}#${e.id}.${String(e.className).slice(0, 40)} title="${e.getAttribute('title') ?? ''}"`), y);
  console.log(lines.join('\n'));
  console.log('--- agent names on that line:');
  console.log(snap.elements.filter((e) => /chevron|filter|refresh|print|add|complete|records/i.test(e.name) && !/dialog/.test(e.context ?? '')).slice(0, 30).map((e) => `[${e.id}] ${e.role} "${e.name}"`).join('\n'));
} finally { await cs.close(); }
