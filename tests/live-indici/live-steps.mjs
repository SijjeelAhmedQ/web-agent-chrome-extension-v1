// Runs a few plain steps on the live tab with the Web Agent's content script — no model, no tokens — and
// prints the controls of the front pop-up after them. For making test data and looking at forms.
//   STEPS='[{"click":"Add to Patient Inbox"},{"type":"Search Patient","text":"STARK"},{"show":true}]' node live-steps.mjs
// A step: {click: name}, {type: name, text}, {select: name, option}, {key: "Enter", on?: name}, {wait: ms},
// {show: true}. Names match a control's whole name (case-insensitive); `nth` picks among several (default: the last,
// the front pop-up's). `like: true` matches a part of the name.
import { contentScript } from './live-cs.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const steps = JSON.parse(process.env.STEPS ?? '[]');
const cs = await contentScript();

const controls = async () => (await cs.send({ kind: 'snapshot', mode: 'interactive', maxElements: 800, maxTextChars: 2000 })).elements ?? [];
async function pick(step, name) {
  const all = await controls();
  const want = name.trim().toLowerCase();
  const named = all.filter((e) => (step.like ? (e.name ?? '').toLowerCase().includes(want) : (e.name ?? '').trim().toLowerCase() === want));
  // In a pop-up first: the page behind it has controls of the same name.
  const inFront = named.filter((e) => e.inDialog || (e.context ?? '').includes('dialog'));
  const hits = step.anywhere || !inFront.length ? named : inFront;
  const el = step.nth === undefined ? hits.at(-1) : hits[step.nth];
  if (!el) throw new Error(`no control named “${name}” (${hits.length} found)`);
  return el;
}

try {
  for (const s of steps) {
    if (s.wait) await sleep(s.wait);
    else if (s.click) {
      const el = await pick(s, s.click);
      await cs.send({ kind: 'click', id: el.id, highlight: false });
      console.log(`clicked [${el.id}] ${el.role} "${el.name}"`);
      await sleep(s.after ?? 1500);
    } else if (s.type) {
      const el = await pick(s, s.type);
      await cs.send({ kind: 'type', id: el.id, text: s.text, clear: true, highlight: false });
      console.log(`typed "${s.text}" into "${el.name}"`);
      await sleep(s.after ?? 300);
    } else if (s.select) {
      const el = await pick(s, s.select);
      await cs.send({ kind: 'select', id: el.id, option: s.option, highlight: false });
      console.log(`chose "${s.option}" in "${el.name}"`);
      await sleep(s.after ?? 800);
    } else if (s.key) {
      const el = s.on ? await pick(s, s.on) : null;
      await cs.send({ kind: 'key', key: s.key, ...(el ? { id: el.id } : {}) });
      console.log(`pressed ${s.key}`);
      await sleep(s.after ?? 1500);
    } else if (s.show) {
      const all = await controls();
      const front = all.filter((e) => e.inDialog || (e.context ?? '').includes('dialog'));
      for (const e of (front.length ? front : all).slice(-(s.last ?? 60))) console.log(`[${e.id}] ${e.role} "${e.name}"${e.value ? ` = ${e.value}` : ''}${e.required ? ' (required)' : ''}`);
    }
  }
} finally {
  await cs.close();
}
