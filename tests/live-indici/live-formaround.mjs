// formAround on the live page: the Save buttons found, and what each one's form still lacks.
import { contentScript } from './live-cs.mjs';
const cs = await contentScript();
try {
  const found = await cs.send({ kind: 'find', query: process.argv[2] ?? 'Save', limit: 6 });
  console.log(Object.keys(found)); for (const el of found.matches ?? found.elements ?? found.results ?? []) {
    if (!/^save$/i.test(el.name)) continue;
    console.log(`[${el.id}] ${el.role} "${el.name}" ${el.context ?? ''}`, JSON.stringify(await cs.send({ kind: 'formAround', id: el.id })));
  }
} finally { await cs.close(); }
