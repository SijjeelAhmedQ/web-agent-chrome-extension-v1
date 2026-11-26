import { afterEach, describe, expect, it } from 'vitest';
import { layoutCheck } from './layoutCheck';

// jsdom lays nothing out: each element gets the box the test gives it (by id), the screen is 375 wide.
type Box = { x: number; y: number; w: number; h: number };
function layout(boxes: Record<string, Box>, opts: { pageWidth?: number; top?: (x: number, y: number) => Element | null } = {}) {
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 375 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 667 });
  Object.defineProperty(document.documentElement, 'scrollWidth', { configurable: true, value: opts.pageWidth ?? 375 });
  for (const e of Array.from(document.querySelectorAll('*'))) {
    const b = boxes[e.id] ?? { x: 0, y: 0, w: 0, h: 0 };
    (e as HTMLElement).getBoundingClientRect = () => ({ left: b.x, top: b.y, right: b.x + b.w, bottom: b.y + b.h, width: b.w, height: b.h, x: b.x, y: b.y, toJSON: () => ({}) }) as DOMRect;
    (e as HTMLElement & { checkVisibility: () => boolean }).checkVisibility = () => b.w > 0;
  }
  document.elementFromPoint = opts.top ?? ((x, y) => Array.from(document.querySelectorAll('button,a')).find((e) => { const r = e.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; }) ?? null);
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the layout at one screen size', () => {
  it('a page that fits, with controls side by side: no problems', () => {
    document.body.innerHTML = '<button id="a">Save</button><button id="b">Cancel</button>';
    layout({ a: { x: 10, y: 10, w: 100, h: 40 }, b: { x: 120, y: 10, w: 100, h: 40 } });
    const r = layoutCheck();
    expect(r.issues).toEqual([]);
    expect(r.width).toBe(375);
  });

  it('a page wider than the screen, and a control that sticks out of it', () => {
    document.body.innerHTML = '<div id="wide"><button id="a">Export</button></div>';
    layout({ wide: { x: 0, y: 0, w: 900, h: 50 }, a: { x: 300, y: 10, w: 120, h: 40 } }, { pageWidth: 900 });
    const r = layoutCheck();
    expect(r.issues.map((i) => i.kind)).toEqual(expect.arrayContaining(['page-scroll', 'off-screen']));
    expect(r.issues.find((i) => i.kind === 'page-scroll')?.what).toMatch(/900px wide on a 375px screen.*div#wide reaches 900px/);
    expect(r.issues.find((i) => i.kind === 'off-screen')?.what).toMatch(/button “Export” is partly off the screen/);
  });

  it('two controls on top of each other — not one inside the other', () => {
    document.body.innerHTML = '<button id="a">Save</button><button id="b">Delete</button><a id="c" href="#"><span>x</span></a>';
    layout({ a: { x: 10, y: 10, w: 100, h: 40 }, b: { x: 60, y: 20, w: 100, h: 40 }, c: { x: 200, y: 10, w: 50, h: 20 } });
    const r = layoutCheck();
    expect(r.totals.overlap).toBe(1);
    expect(r.issues[0].what).toMatch(/button “Save” and button “Delete” overlap by 50×30px/);
  });

  it('a button something else covers: a tap lands on that', () => {
    document.body.innerHTML = '<button id="a">Book</button><div id="banner">Cookie banner</div>';
    layout({ a: { x: 10, y: 600, w: 100, h: 40 }, banner: { x: 0, y: 580, w: 375, h: 87 } }, { top: () => document.getElementById('banner') });
    const r = layoutCheck();
    expect(r.issues.find((i) => i.kind === 'hidden-button')?.what).toMatch(/button “Book” is covered by div#banner/);
  });

  it('hidden on purpose is not a fault (a closed drawer slid off-screen, aria-hidden)', () => {
    document.body.innerHTML = '<nav id="drawer" aria-hidden="true"><a id="l" href="/x">Menu item</a></nav>';
    layout({ drawer: { x: -300, y: 0, w: 300, h: 667 }, l: { x: -290, y: 10, w: 200, h: 30 } });
    expect(layoutCheck().issues).toEqual([]);
  });
});
