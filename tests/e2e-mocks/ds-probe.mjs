import { readFileSync } from 'node:fs';
const key = readFileSync('C:/Users/92313/.webagent-openrouter.env', 'utf8').match(/OPENROUTER_KEY\s*=\s*(\S+)/)[1];
const tools = [
  { type: 'function', function: { name: 'type', description: 'Type text into a text field, search box, combobox or editor.', parameters: { type: 'object', properties: { id: { type: 'number' }, text: { type: 'string' } }, required: ['id', 'text'] } } },
  { type: 'function', function: { name: 'click_text', description: 'Click visible text. It only clicks — it never types.', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } },
];
const body = { model: 'deepseek/deepseek-v4-flash', tool_choice: 'auto', tools, messages: [
  { role: 'system', content: 'You operate a web page with tools.' },
  { role: 'user', content: 'The page shows: [3800] textbox "Add reason to view patient file" value="" and [3801] button "Save". Enter the reason: follow up' },
] };
const r = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const j = await r.json();
console.log(r.status, JSON.stringify(j.choices?.[0]?.message ?? j).slice(0, 800));
