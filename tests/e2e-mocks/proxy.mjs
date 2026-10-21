// Logs every model call (size, duration, tokens) between the extension and Ollama.
import http from 'node:http';
import { writeFileSync } from 'node:fs';

let n = 0;
http
  .createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const started = Date.now();
    const i = ++n;
    const upstream = await fetch(`http://localhost:11434${req.url}`, { method: req.method, headers: { 'content-type': 'application/json' }, body: req.method === 'POST' ? body : undefined });
    const text = await upstream.text();
    let usage = '';
    try {
      const j = JSON.parse(text);
      usage = `in=${j.usage?.prompt_tokens} out=${j.usage?.completion_tokens} tools=${(j.choices?.[0]?.message?.tool_calls ?? []).map((t) => t.function.name).join(',')}`;
    } catch {}
    console.log(`#${i} ${req.url} body=${body.length}B ${Date.now() - started}ms ${usage}`);
    if (req.method === 'POST') writeFileSync(`${import.meta.dirname}/req-${i}.json`, body);
    res.writeHead(upstream.status, { 'content-type': 'application/json' });
    res.end(text);
  })
  .listen(4601, () => console.log('proxy on 4601'));
