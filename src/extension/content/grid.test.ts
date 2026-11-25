import { describe, expect, it } from 'vitest';
import { contextOf } from './elements';
import { gridIn, gridRowOf, gridsIn, rowLine } from './grid';

// OctansCare's Stations list: rows of divs, a header row of another class before them.
const row = (n: number, code: string, name: string) =>
  `<div class="oa-row"><span class="oa-cell"><input type="checkbox" aria-label="Select ${name}"></span><span class="oa-cell">${n}</span><span class="oa-cell">${code}</span><span class="oa-cell">${name}</span><span class="oa-cell">Steiner Wing</span><span class="oa-cell"><button>Edit station</button><button>Remove station</button></span></div>`;
const STATIONS = `<div class="oc-board"><div class="oa-head"><span></span><span>Order</span><span>Code</span><span>Name</span><span>Wing</span><span>Actions</span></div>${row(1, 'SWTT2', 'Tall Table 2')}${row(2, 'SWTT1', 'Tall Table 1')}${row(3, 'SWMT1', 'Medium Table 1')}</div>`;

describe('a list drawn with divs, not a table', () => {
  it('is found: its header, and its rows in order', () => {
    document.body.innerHTML = STATIONS;
    const g = gridIn(document.querySelector('.oc-board')!)!;
    expect(g.rows).toHaveLength(3);
    expect(g.header?.className).toBe('oa-head');
    expect(rowLine(g.rows[1])).toBe('2 | SWTT1 | Tall Table 1 | Steiner Wing | Edit stationRemove station');
    expect(gridsIn(document)).toHaveLength(1);
  });

  it("gives a row's buttons their row — row 2's Remove is not row 3's", () => {
    document.body.innerHTML = STATIONS;
    const removes = [...document.querySelectorAll('button')].filter((b) => b.textContent === 'Remove station');
    expect(gridRowOf(removes[1])?.index).toBe(2);
    expect(contextOf(removes[1])).toBe('row 2 “2 · SWTT1 · Tall Table 1 · Steiner Wing”');
    expect(contextOf(removes[2])).toMatch(/^row 3 “3 · SWMT1/);
  });

  it('is not a menu, a page of sections, or rows without cells', () => {
    document.body.innerHTML = `
      <nav id="menu"><div class="item"><a>A</a><a>a</a><a>1</a></div><div class="item"><a>B</a><a>b</a><a>2</a></div><div class="item"><a>C</a><a>c</a><a>3</a></div></nav>
      <div id="page"><section class="card"><h2>One</h2><p>x</p><p>y</p></section><div class="hero"><p>1</p><p>2</p><p>3</p></div><footer><p>a</p><p>b</p><p>c</p></footer></div>
      <div id="plain"><div class="r">one</div><div class="r">two</div><div class="r">three</div></div>`;
    expect(gridIn(document.querySelector('#menu')!)).toBeNull();
    expect(gridIn(document.querySelector('#page')!)).toBeNull();
    expect(gridIn(document.querySelector('#plain')!)).toBeNull();
  });
});
