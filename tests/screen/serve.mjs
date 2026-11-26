// A tiny server for the Phase 3 test pages (tests/screen) on http://localhost:8765 — the extension reads http pages.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = dirname(fileURLToPath(import.meta.url));
createServer(async (req, res) => {
  const name = (req.url ?? '/').split('?')[0].replace(/^\/+/, '') || 'nonresponsive.html';
  if (!/^[\w.-]+\.html$/.test(name)) return res.writeHead(404).end();
  try {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(await readFile(join(dir, name)));
  } catch {
    res.writeHead(404).end();
  }
}).listen(8765, '127.0.0.1', () => console.log('http://localhost:8765/'));
