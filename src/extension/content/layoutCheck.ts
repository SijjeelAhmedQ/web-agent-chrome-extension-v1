import type { LayoutIssue, LayoutReport } from '@/shared/types/page';
import { accessibleName, collectInteractive, isVisible } from './elements';

/**
 * What is wrong with the page's layout at the size it is shown now — read after the window is made phone-, tablet-
 * or desktop-sized (Phase 3, responsiveness): the page scrolls sideways, a control sits partly or wholly off the
 * screen, two controls cover each other, text is cut off, a button can't be reached (something covers it).
 * Only what a person would notice: hidden menus, tooltips and screen-reader-only text are left alone.
 */

/** Issues of one kind at most — a table of 200 cut cells is one finding, not 200. */
const PER_KIND = 12;
/** Overlap smaller than this (px) is a border or a shadow, not one control over another. */
const MIN_OVERLAP = 6;

/** A control by its name (button “Export”); a box by its id or class (div#wide) — what a developer finds it by. */
const label = (el: Element) => {
  const tag = el.tagName.toLowerCase();
  const control = /^(a|button|input|select|textarea|label|img|h[1-6])$/.test(tag) || el.hasAttribute('role');
  if (!control) {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '';
    return el.id ? `${tag}#${el.id}` : cls ? `${tag}.${cls}` : tag;
  }
  const name = accessibleName(el).replace(/\s+/g, ' ').trim();
  return name ? `${tag} “${name.slice(0, 60)}”` : tag;
};
const box = (r: DOMRect) => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });

/** Visually hidden on purpose (sr-only, a closed drawer slid off-screen): not a layout fault. */
function meantHidden(el: Element): boolean {
  for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) {
    const s = getComputedStyle(e);
    // (An opacity not set reads as '' in some engines: that is not 0.)
    if (s.visibility === 'hidden' || s.display === 'none' || (s.opacity !== '' && Number(s.opacity) === 0)) return true;
    if (s.clip === 'rect(0px, 0px, 0px, 0px)' || s.clipPath === 'inset(50%)') return true;
    if (e.getAttribute('aria-hidden') === 'true' || e.hasAttribute('inert')) return true;
  }
  const r = el.getBoundingClientRect();
  return r.width <= 1 && r.height <= 1;
}

export function layoutCheck(): LayoutReport {
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = window.innerHeight;
  const issues: LayoutIssue[] = [];
  const count = new Map<LayoutIssue['kind'], number>();
  const add = (i: LayoutIssue) => {
    const n = count.get(i.kind) ?? 0;
    count.set(i.kind, n + 1);
    if (n < PER_KIND) issues.push(i);
  };

  // 1. The page scrolls sideways.
  const pageWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0);
  if (pageWidth > vw + 1) {
    // What sticks out the most is usually what causes it.
    const widest = Array.from(document.body?.querySelectorAll('*') ?? [])
      .filter((e) => !meantHidden(e))
      .map((e) => ({ e, right: e.getBoundingClientRect().right }))
      .filter((x) => x.right > vw + 1)
      .sort((a, b) => b.right - a.right)
      .filter((x, i, all) => !all.slice(0, i).some((y) => y.e.contains(x.e)))[0];
    add({ kind: 'page-scroll', what: `The page is ${pageWidth}px wide on a ${vw}px screen: it scrolls sideways${widest ? ` — widest: ${label(widest.e)} reaches ${Math.round(widest.right)}px` : ''}.` });
  }

  const { elements } = collectInteractive();
  const controls = elements.filter((el) => isVisible(el) && !meantHidden(el));

  // 2. Controls partly or wholly off the screen to the side (below is just scrolling).
  for (const el of controls) {
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1) {
      const whole = r.left >= vw || r.right <= 0;
      add({ kind: 'off-screen', what: `${label(el)} is ${whole ? 'wholly' : 'partly'} off the screen (x ${Math.round(r.left)}–${Math.round(r.right)} on a ${vw}px screen).`, rect: box(r) });
    }
  }

  // 3. Two controls covering each other (not one inside the other).
  const rects = controls.map((el) => ({ el, r: el.getBoundingClientRect() })).filter((x) => x.r.top < vh * 3);
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (w >= MIN_OVERLAP && h >= MIN_OVERLAP) add({ kind: 'overlap', what: `${label(a.el)} and ${label(b.el)} overlap by ${Math.round(w)}×${Math.round(h)}px.`, rect: box(a.r) });
    }
  }

  // 4. Text cut off: a box that hides what doesn't fit, and doesn't fit (an ellipsis is the page saying so on purpose).
  for (const el of Array.from(document.body?.querySelectorAll('*') ?? [])) {
    if (!el.childNodes.length || !Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())) continue;
    const s = getComputedStyle(el);
    if (s.overflowX !== 'hidden' && s.overflow !== 'hidden' && s.overflowY !== 'hidden') continue;
    if (s.textOverflow === 'ellipsis' || meantHidden(el) || !isVisible(el)) continue;
    const h = el as HTMLElement;
    const cutWide = h.scrollWidth > h.clientWidth + 2;
    const cutTall = s.overflowY === 'hidden' && h.scrollHeight > h.clientHeight + 2 && h.clientHeight > 0;
    if (cutWide || cutTall) add({ kind: 'cut-text', what: `Text cut off in ${label(el)}: “${(h.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 50)}”.`, rect: box(el.getBoundingClientRect()) });
  }

  // 5. A button on screen that something else covers: a click there lands on the other thing.
  for (const el of controls) {
    if (!/^(button|a)$/i.test(el.tagName) && el.getAttribute('role') !== 'button') continue;
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > vh || r.left < 0 || r.right > vw) continue;
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (top && top !== el && !el.contains(top) && !top.contains(el)) {
      add({ kind: 'hidden-button', what: `${label(el)} is covered by ${label(top)} — a tap on it lands on that.`, rect: box(r) });
    }
  }

  const totals = Object.fromEntries(count) as LayoutReport['totals'];
  return { width: vw, height: vh, pageWidth, issues, totals };
}
