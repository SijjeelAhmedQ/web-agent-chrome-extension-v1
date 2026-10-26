// Opens each named control on a live tab, prints what appeared, then presses Escape — to learn a page's
// menus and pop-ups. Never give it a control that saves or files something.
//   TAB=inbox-app node live-explore.mjs "Actions" "AI (All)" …
import { contentScript } from './live-cs.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SAVES = /^(save|file|file all|opt out|submit|delete|send|complete|confirm|yes|ok)\b/i;
const cs = await contentScript();
try {
  for (const name of process.argv.slice(2)) {
    if (SAVES.test(name)) {
      console.log(`\n### ${name}: skipped — it would change something`);
      continue;
    }
    const { matches } = await cs.send({ kind: 'find', query: name, limit: 10 });
    const hit = matches.find((m) => m.name.trim().toLowerCase() === name.toLowerCase()) ?? matches.find((m) => m.name.toLowerCase().startsWith(name.toLowerCase()));
    if (!hit) {
      console.log(`\n### ${name}: not found`);
      continue;
    }
    await cs.send({ kind: 'click', id: hit.id, highlight: false });
    await sleep(1500);
    const effect = await cs.send({ kind: 'effect' }).catch(() => null);
    const { dialogs } = await cs.send({ kind: 'dialogs', waitMs: 300 });
    console.log(`\n### ${name} [${hit.role}]`);
    for (const d of dialogs) console.log(`  pop-up “${d.title}”: ${String(d.fullText ?? d.text ?? '').replace(/\s+/g, ' ').slice(0, 600)}`);
    if (effect?.added?.length) console.log(`  appeared: ${effect.added.slice(0, 40).join(' | ').slice(0, 1500)}`);
    await cs.send({ kind: 'key', key: 'Escape' }).catch(() => {});
    await sleep(600);
  }
} finally {
  await cs.close();
}
