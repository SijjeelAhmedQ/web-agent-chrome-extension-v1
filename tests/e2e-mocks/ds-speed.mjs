// Same request (our real tool list, a real page) to each model — time, the tool it calls, the model that answered.
import { readFileSync } from 'node:fs';
const key = readFileSync('C:/Users/92313/.webagent-openrouter.env', 'utf8').match(/OPENROUTER_KEY\s*=\s*(\S+)/)[1];
const call = JSON.parse(readFileSync('../indici-live/model-calls.json', 'utf8'))[3].request;
const tools = JSON.parse(JSON.stringify(call.tools).replace(/"exclusiveMinimum":true,"minimum":0/g, '"exclusiveMinimum":0'));
for (const model of ['deepseek/deepseek-v4-flash', '~deepseek/deepseek-v4-flash-latest']) {
  for (let i = 0; i < 2; i++) {
    const t0 = Date.now();
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...call, model, tools, usage: { include: true } }) });
    const j = await r.json();
    const m = j.choices?.[0]?.message;
    const calls = (m?.tool_calls ?? []).map((c) => `${c.function.name}(${c.function.arguments.slice(0, 50)})`).join(', ');
    console.log(`${model.padEnd(36)} ${((Date.now() - t0) / 1000).toFixed(1)}s  served by ${j.model ?? '?'}  cost $${j.usage?.cost}  → ${calls || (m?.content ?? JSON.stringify(j.error ?? j)).slice(0, 80)}`);
  }
}
