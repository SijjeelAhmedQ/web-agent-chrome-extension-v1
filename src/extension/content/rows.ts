import type { TableResult, VisualRow } from '@/shared/types/page';
import { isVisible } from './elements';

/**
 * Rows as the user sees them — what sits side by side on one line, left to right — whatever the
 * markup (a table, divs, spans). A result row “HbA1c   Normal   Abnormal” reads as three cells, and
 * an empty column stays empty, which the flat text of the page can't tell apart.
 */

/** Text that isn't data: controls, field labels, tabs. */
const NOT_DATA = 'a,button,label,input,select,option,textarea,[role=tab],[role=button],[role=link],script,style,noscript';

/** “red”, “green”… for a CSS colour — what the user would call it; '' for the usual dark text. */
export function colourName(css: string): string {
  const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
  if (!m) return '';
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (m[4] !== undefined && Number(m[4]) < 0.3) return '';
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 40) return max < 90 ? '' : 'grey';
  // Orange (255,165,0) has much green: red below a third of the red, orange up to ~80%.
  if (r === max && r > 140 && b < 0.5 * r) {
    if (g <= 0.35 * r) return 'red';
    if (g <= 0.8 * r) return 'orange';
  }
  if (g === max && g > 100 && r < 0.75 * g) return 'green';
  if (b === max && b > 100) return r < 0.6 * b && g < 0.75 * b ? 'blue' : '';
  return '';
}

interface Piece {
  text: string;
  left: number;
  top: number;
  bottom: number;
  red: boolean;
}

function piecesIn(root: Element, out: Piece[], dx = 0, dy = 0) {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const seen = new Set<Element>();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!el || seen.has(el) || !node.textContent?.trim()) continue;
    seen.add(el);
    // Controls and their captions (“Confidential” beside its checkbox) are not data.
    if (el.closest(NOT_DATA) || el.parentElement?.querySelector(':scope > input,:scope > select,:scope > textarea') || el.previousElementSibling?.matches('input,select')) continue;
    // The element's own text (not its children's — they are pieces of their own).
    const text = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text || !isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const view = doc.defaultView;
    out.push({ text, left: r.left + dx, top: r.top + dy, bottom: r.bottom + dy, red: !!view && colourName(view.getComputedStyle(el).color) === 'red' });
  }
  for (const frame of Array.from(root.querySelectorAll('iframe'))) {
    try {
      const body = frame.contentDocument?.body;
      if (!body) continue;
      const f = frame.getBoundingClientRect();
      piecesIn(body, out, dx + f.left, dy + f.top);
    } catch {
      // Another site's frame: its rows can't be read from here.
    }
  }
}

export function visualRows(root: Element, max = 120): VisualRow[] {
  const pieces: Piece[] = [];
  piecesIn(root, pieces);
  pieces.sort((a, b) => a.top - b.top || a.left - b.left);
  const rows: { top: number; bottom: number; pieces: Piece[] }[] = [];
  for (const p of pieces) {
    // Same line: the two overlap by at least half the shorter one's height.
    const row = rows.find((r) => Math.min(r.bottom, p.bottom) - Math.max(r.top, p.top) >= 0.5 * Math.min(r.bottom - r.top, p.bottom - p.top));
    if (row) {
      row.pieces.push(p);
      row.top = Math.min(row.top, p.top);
      row.bottom = Math.max(row.bottom, p.bottom);
    } else rows.push({ top: p.top, bottom: p.bottom, pieces: [p] });
  }
  return rows
    .sort((a, b) => a.top - b.top)
    .slice(0, max)
    .map((r) => {
      const cells = r.pieces.sort((a, b) => a.left - b.left);
      return { cells: cells.map((c) => c.text), red: cells.map((c) => c.red) };
    });
}

/** The list a heading or caption names (“Long Term Diagnosis”): the first table after it on the page. */
function tableUnder(want: string, tables: Element[], scope: Element | Document): Element | undefined {
  const labels = Array.from(scope.querySelectorAll('h1,h2,h3,h4,h5,h6,legend,caption,label,span,div,a,p,li'))
    .filter((e) => isVisible(e) && e.children.length <= 2)
    .map((e) => ({ e, text: ((e as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim().toLowerCase() }))
    .filter((x) => x.text.includes(want) && x.text.length <= want.length + 30)
    .sort((a, b) => a.text.length - b.text.length);
  // Hidden and empty tables count: a heading over an empty list must not take the next section's list.
  const all = Array.from(scope.querySelectorAll('table,[role=grid],[role=table]')).filter((t) => !t.querySelector('table,[role=grid],[role=table]'));
  for (const { e } of labels) {
    const next = all.find((t) => !!(e.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING));
    if (next && tables.includes(next)) return next;
  }
  return undefined;
}

/** A list on the page (or in the pop-up in front): its rows, and each row's text colour when they differ. */
export function readTable(near: string, max: number, scope: Element | Document = document): TableResult {
  const want = near.trim().toLowerCase();
  const rowsOf = (t: Element) => Array.from(t.querySelectorAll('tr,[role=row]')).filter((r) => isVisible(r));
  const tables = Array.from(scope.querySelectorAll('table,[role=grid],[role=table]')).filter((t) => isVisible(t) && !t.querySelector('table,[role=grid],[role=table]'));
  const table =
    (want && tables.find((t) => (t as HTMLElement).innerText?.toLowerCase().includes(want))) ||
    (want && tableUnder(want, tables, scope)) ||
    [...tables].sort((a, b) => rowsOf(b).length - rowsOf(a).length)[0];
  if (!table) return { found: false, headers: [], rows: [], total: 0 };
  const plainText = (c: Element) => ((c as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim();
  // A cell that is only a sign (“!”, “✓”, “●”): its colour or title is what it says (a priority, a status).
  const cellText = (c: Element) => {
    const text = plainText(c);
    if (!text || /\p{L}|\d/u.test(text) || text.length > 3) return text;
    const marked = Array.from(c.querySelectorAll('*')).find((e) => (e.textContent ?? '').trim() === text) ?? c;
    const title = (marked.getAttribute('title') ?? c.getAttribute('title') ?? '').trim();
    const colour = colourName(getComputedStyle(marked).color);
    return [text, title || (colour ? `(${colour})` : '')].filter(Boolean).join(' ');
  };
  const all = rowsOf(table);
  const headerRow = all.find((r) => r.querySelector('th,[role=columnheader]'));
  // A grid with its header in a table of its own (fixed headers): the table just before it.
  let headers = headerRow ? Array.from(headerRow.children).map(cellText) : [];
  if (!headers.length) {
    const prev = tables[tables.indexOf(table) - 1];
    const head = prev?.querySelector('tr');
    if (head && head.querySelector('th')) headers = Array.from(head.children).map(cellText);
  }
  const rows = all
    .filter((r) => r !== headerRow && !r.querySelector('th'))
    .map((r) => {
      const cells = Array.from(r.children).map(cellText);
      // The row's colour: that of its first text (a date, a name) — the rest follows it.
      const first = Array.from(r.querySelectorAll('*')).find((e) => Array.from(e.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()));
      const colour = first ? colourName(getComputedStyle(first).color) : '';
      return { cells, colour };
    })
    .filter((r) => r.cells.some(Boolean));
  return { found: true, headers, rows: rows.slice(0, max), total: rows.length };
}
