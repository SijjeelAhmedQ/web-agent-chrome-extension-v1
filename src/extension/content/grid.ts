/**
 * Lists drawn without a table: rows of the same kind side by side (`div.oa-row` × 38, each with its cells), often
 * with a header row of another class before them (`div.oa-head`). OctansCare's Stations list is one — read_table
 * found “no list”, a row's Edit and Remove buttons had no row to tell them apart, and its text came one cell a line.
 */

/** Rows of a list at least. */
const MIN_ROWS = 3;
/** Cells of a row at least. */
const MIN_CELLS = 3;

const textOf = (el: Element) => ((el as HTMLElement).innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();
const kindOf = (el: Element) => `${el.tagName}.${typeof el.className === 'string' ? el.className.trim() : ''}`;

export interface Grid {
  container: Element;
  header: Element | null;
  rows: Element[];
}

/** A page read asks of each control's ancestors: the answer for a while (one read), not worked out again for each. */
const known = new WeakMap<Element, { at: number; grid: Grid | null }>();
const FRESH_MS = 1_500;

/** The rows of `container`, when it is such a list: its children of one kind, with cells, and text in them. */
export function gridIn(container: Element): Grid | null {
  const was = known.get(container);
  if (was && Date.now() - was.at < FRESH_MS) return was.grid;
  const grid = findGrid(container);
  known.set(container, { at: Date.now(), grid });
  return grid;
}

function findGrid(container: Element): Grid | null {
  const kids = Array.from(container.children);
  if (kids.length < MIN_ROWS) return null;
  const counts = new Map<string, number>();
  for (const k of kids) if (k.childElementCount >= MIN_CELLS && kindOf(k).split('.')[1]) counts.set(kindOf(k), (counts.get(kindOf(k)) ?? 0) + 1);
  const [kind, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
  // Most of the children: a list, not a page's sections that happen to share a class.
  if (n < MIN_ROWS || n < kids.length * 0.6) return null;
  const rows = kids.filter((k) => kindOf(k) === kind);
  // Rows with the same number of cells, each with words or numbers in two of them at least.
  const cells = rows[0].childElementCount;
  if (rows.some((r) => Math.abs(r.childElementCount - cells) > 1)) return null;
  if (rows.slice(0, 5).some((r) => Array.from(r.children).filter((c) => textOf(c)).length < 2)) return null;
  // A table's rows are tables already; a menu's items are links, not cells.
  if (container.closest('table,[role=table],[role=grid],nav,[role=menu],[role=listbox],[role=tablist]')) return null;
  const first = kids.indexOf(rows[0]);
  const header = kids.slice(0, first).reverse().find((k) => Math.abs(k.childElementCount - cells) <= 1 && textOf(k)) ?? null;
  return { container, header, rows };
}

/** The grid row `el` is in, and which one (1 = the first under the header). */
export function gridRowOf(el: Element): { row: Element; index: number; grid: Grid } | null {
  let box: Element = el;
  for (let depth = 0; depth < 8; depth++) {
    const parent = box.parentElement;
    if (!parent) return null;
    if (parent.childElementCount >= MIN_ROWS && box.childElementCount >= MIN_CELLS) {
      const grid = gridIn(parent);
      if (grid) {
        const index = grid.rows.indexOf(box);
        return index >= 0 ? { row: box, index: index + 1, grid } : null; // (not a row: the header)
      }
    }
    box = parent;
  }
  return null;
}

/** The lists of this kind in `root`, outermost first, at most `max`. */
export function gridsIn(root: Element | Document, max = 20): Grid[] {
  const found: Grid[] = [];
  for (const el of Array.from(root.querySelectorAll('div,ul,ol,section,tbody'))) {
    if (el.childElementCount < MIN_ROWS || found.some((g) => g.container.contains(el))) continue;
    const g = gridIn(el);
    if (g) found.push(g);
    if (found.length >= max) break;
  }
  return found;
}

/** A row's cells as text, one each (an empty cell stays: the columns line up with the header). */
export const cellsOf = (row: Element): string[] => Array.from(row.children).map(textOf);

/** A row as one line: “1 | SWTT2 | Tall Table 2 | … | Free”. */
export const rowLine = (row: Element): string => cellsOf(row).filter(Boolean).join(' | ');
