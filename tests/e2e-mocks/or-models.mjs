const r = await fetch('https://openrouter.ai/api/v1/models');
const j = await r.json();
for (const m of j.data.filter((m) => /deepseek-v4/i.test(m.id) || /deepseek-v4/i.test(m.canonical_slug ?? ''))) {
  console.log(m.id, '| ctx', m.context_length, '| $in/M', (Number(m.pricing?.prompt) * 1e6).toFixed(2), '$out/M', (Number(m.pricing?.completion) * 1e6).toFixed(2), '|', (m.description ?? '').slice(0, 140).replace(/\n/g, ' '));
}
