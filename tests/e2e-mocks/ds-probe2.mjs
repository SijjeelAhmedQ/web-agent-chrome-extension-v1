import { readFileSync } from 'node:fs';
const key = readFileSync('C:/Users/92313/.webagent-openrouter.env', 'utf8').match(/OPENROUTER_KEY\s*=\s*(\S+)/)[1];
const sent = JSON.parse(readFileSync('../indici-live/model-calls.json', 'utf8'))[3].request.tools;
const pick = (names, fix) => sent.filter((t) => names.includes(t.function.name)).map((t) => fix ? JSON.parse(JSON.stringify(t).replace(/"exclusiveMinimum":true,"minimum":0/g, '"exclusiveMinimum":0')) : t);
const ask = async (tools) => {
  const body = { model: 'deepseek/deepseek-v4-flash', tool_choice: 'auto', tools, messages: [
    { role: 'system', content: 'You operate a web page with tools.' },
    { role: 'user', content: 'The page shows: [3800] textbox "Add reason to view patient file" value="" and [3801] button "Save". Enter the reason: follow up' } ] };
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  const m = j.choices?.[0]?.message;
  return m ? (m.tool_calls ?? []).map((c) => `${c.function.name}(${c.function.arguments})`).join(', ') || `text: ${m.content}` : JSON.stringify(j).slice(0, 300);
};
console.log('as sent      :', await ask(pick(['type', 'click_text', 'click'], false)));
console.log('numeric bound:', await ask(pick(['type', 'click_text', 'click'], true)));
