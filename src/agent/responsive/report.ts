import type { LayoutIssue, LayoutReport } from '@/shared/types/page';

/**
 * Phase 3, responsiveness: the page shown at screen sizes people use, what breaks at each, and the report of it —
 * a short summary for the agent's answer, Markdown, and HTML with each size's screenshot and its faults marked.
 */

export interface ScreenSize {
  name: string;
  width: number;
  height: number;
}

/** The four sizes of the roadmap: a phone, a tablet, a laptop and a desktop. */
export const SCREEN_SIZES: ScreenSize[] = [
  { name: 'Phone', width: 375, height: 667 },
  { name: 'Tablet', width: 768, height: 1024 },
  { name: 'Laptop', width: 1366, height: 768 },
  { name: 'Desktop', width: 1920, height: 1080 },
];

export interface SizeResult {
  size: ScreenSize;
  report: LayoutReport;
  /** JPEG, base64 (no data: prefix); empty when it couldn't be taken. */
  shot: string;
}

const KIND_LABEL: Record<LayoutIssue['kind'], string> = {
  'page-scroll': 'Scrolls sideways',
  'off-screen': 'Off the screen',
  overlap: 'Overlapping',
  'cut-text': 'Text cut off',
  'hidden-button': 'Button covered',
};
const KINDS = Object.keys(KIND_LABEL) as LayoutIssue['kind'][];

const total = (r: LayoutReport) => Object.values(r.totals).reduce((a, b) => a + (b ?? 0), 0);
const counts = (r: LayoutReport) =>
  KINDS.filter((k) => r.totals[k])
    .map((k) => `${r.totals[k]} ${KIND_LABEL[k].toLowerCase()}`)
    .join(', ');

/** For the agent: each size in a line or two, the worst faults named. */
export function summary(results: SizeResult[]): string {
  const lines = results.map(({ size, report }) => {
    const n = total(report);
    if (!n) return `- ${size.name} ${size.width}×${size.height}: no problems found.`;
    const named = report.issues.slice(0, 3).map((i) => `  · ${i.what}`);
    return [`- ${size.name} ${size.width}×${size.height}: ${n} problem${n === 1 ? '' : 's'} — ${counts(report)}.`, ...named].join('\n');
  });
  const bad = results.filter((r) => total(r.report)).map((r) => r.size.name);
  const head = bad.length ? `Problems at ${bad.join(', ')}.` : 'The page looks right at every size checked.';
  return [head, ...lines].join('\n');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The report as Markdown — what was found at each size (the screenshots are in the HTML report). */
export function reportMarkdown(results: SizeResult[], page: { url: string; title: string }, at = new Date()): string {
  const out = [`# Responsiveness — ${page.title || page.url}`, '', `${page.url}  `, `Checked ${at.toLocaleString()}.`, '', '| Size | Screen | Problems |', '|---|---|---|'];
  for (const { size, report } of results) out.push(`| ${size.name} | ${size.width}×${size.height} | ${total(report) ? counts(report) : 'none'} |`);
  for (const { size, report } of results) {
    out.push('', `## ${size.name} — ${size.width}×${size.height}`);
    if (!report.issues.length) {
      out.push('', 'No problems found.');
      continue;
    }
    for (const k of KINDS) {
      const of = report.issues.filter((i) => i.kind === k);
      if (!of.length) continue;
      out.push('', `### ${KIND_LABEL[k]}${(report.totals[k] ?? 0) > of.length ? ` (${of.length} of ${report.totals[k]})` : ''}`, ...of.map((i) => `- ${i.what}`));
    }
  }
  return `${out.join('\n')}\n`;
}

/** The report as one HTML file: each size's screenshot with its faults outlined, then the list of them. */
export function reportHtml(results: SizeResult[], page: { url: string; title: string }, at = new Date()): string {
  const sections = results
    .map(({ size, report, shot }) => {
      const marks = report.issues
        .filter((i) => i.rect)
        .map((i, n) => {
          const r = i.rect!;
          const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(2)}%`;
          return `<span class="mark k-${i.kind}" title="${esc(i.what)}" style="left:${pct(r.x, size.width)};top:${pct(r.y, size.height)};width:${pct(r.w, size.width)};height:${pct(r.h, size.height)}">${n + 1}</span>`;
        })
        .join('');
      const list = report.issues.length
        ? `<ol>${report.issues.map((i) => `<li><b>${KIND_LABEL[i.kind]}</b> — ${esc(i.what)}</li>`).join('')}</ol>`
        : '<p class="ok">No problems found.</p>';
      const img = shot ? `<div class="shot"><img alt="${esc(size.name)} screenshot" src="data:image/jpeg;base64,${shot}">${marks}</div>` : '<p class="muted">No screenshot.</p>';
      return `<section><h2>${esc(size.name)} <small>${size.width}×${size.height}</small></h2><p class="muted">${total(report) ? esc(counts(report)) : 'No problems'}</p>${img}${list}</section>`;
    })
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Responsiveness — ${esc(page.title || page.url)}</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1a1a1a;--muted:#666;--line:#ddd}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#eee;--muted:#999;--line:#333}}
body{margin:0;padding:24px 16px;font:15px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg)}
main{max-width:1100px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}h2{font-size:18px;margin:32px 0 4px}small,.muted{color:var(--muted)}
section{border-top:1px solid var(--line)}.shot{position:relative;display:inline-block;max-width:100%;border:1px solid var(--line)}
.shot img{display:block;max-width:100%;height:auto}
.mark{position:absolute;box-sizing:border-box;border:2px solid #e5484d;padding:1px 3px;font:600 11px/1 system-ui;color:#fff;text-shadow:0 0 2px #000}
.k-overlap{border-color:#f5a524}.k-cut-text{border-color:#3e8ef7}.k-hidden-button{border-color:#a855f7}
ol{padding-left:22px}.ok{color:#2f9e44}a{color:inherit;word-break:break-all}
</style></head><body><main><h1>Responsiveness — ${esc(page.title || page.url)}</h1><p class="muted"><a href="${esc(page.url)}">${esc(page.url)}</a> · checked ${esc(at.toLocaleString())}</p>${sections}</main></body></html>`;
}
