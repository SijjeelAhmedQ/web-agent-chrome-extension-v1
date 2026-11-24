// One line per command of each run log: time, model calls, tokens in, Headroom's before → after.
import { readFileSync } from 'node:fs';
for (const file of process.argv.slice(2)) {
  const text = readFileSync(file, 'utf8');
  const turns = text.split(/^>>> /m).slice(1);
  let T = 0, C = 0, K = 0;
  console.log(`\n## ${file}`);
  for (const t of turns) {
    const req = t.split('\n')[0];
    const secs = Number(t.match(/^--- (\d+)s ---/m)?.[1] ?? 0);
    const m = t.match(/Model calls · (\d+) · ([\d.]+)(k?) tokens in/);
    const calls = Number(m?.[1] ?? 0), tok = m ? Number(m[2]) * (m[3] ? 1000 : 1) : 0;
    const hr = t.match(/Headroom saved ([\d.]+k?)/)?.[1] ?? '';
    T += secs; C += calls; K += tok;
    console.log(`${req.slice(0, 42).padEnd(42)} ${String(secs).padStart(4)}s ${String(calls).padStart(3)} calls ${String(Math.round(tok / 1000)).padStart(4)}k in ${hr ? 'HR saved ' + hr : ''}`);
  }
  console.log(`TOTAL ${Math.round(T / 60)} min · ${C} calls · ${Math.round(K / 1000)}k tokens in`);
}
