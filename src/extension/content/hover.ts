import type { ElementInfo } from '@/shared/types/page';
import type { HoverResult, MenuResult } from '../messaging/protocol';
import { accessibleName, collectInteractive, roleOf } from './elements';
import { highlight } from './overlay';
import { describeElement } from './snapshot';
import { isAnchor, isHTML } from './dom';

/**
 * Hovering without a real mouse. Two kinds of hover menus exist:
 *   - JavaScript menus open on mouseenter/mouseover — synthetic events open them.
 *   - CSS menus open on `:hover` (`li:hover > ul { display: block }`) — no script can set
 *     `:hover`, so every same-origin `:hover` rule is copied with a class in its place and
 *     that class is put on the hovered element and its ancestors, as `:hover` would be.
 * Both are applied together, so either kind of menu opens.
 */

export const HOVER_CLASS = '__wa-hover';
const STYLE_ID = '__wa-hover-style';

let chain: Element[] = [];
let builtFor = -1;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Copies the page's `:hover` rules with `.__wa-hover` instead (rebuilt when stylesheets change). */
function syncHoverStyles(doc: Document) {
  const sheets = Array.from(doc.styleSheets);
  if (builtFor === sheets.length && doc.getElementById(STYLE_ID)) return;
  const rewrite = (rules: CSSRuleList): string[] => {
    const out: string[] = [];
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        if (rule.selectorText.includes(':hover')) out.push(`${rule.selectorText.replace(/:hover/g, `.${HOVER_CLASS}`)}{${rule.style.cssText}}`);
      } else if (rule instanceof CSSMediaRule) {
        const inner = rewrite(rule.cssRules);
        if (inner.length) out.push(`@media ${rule.conditionText}{${inner.join('')}}`);
      } else if (rule instanceof CSSSupportsRule) {
        const inner = rewrite(rule.cssRules);
        if (inner.length) out.push(`@supports ${rule.conditionText}{${inner.join('')}}`);
      }
    }
    return out;
  };
  const css: string[] = [];
  for (const sheet of sheets) {
    if ((sheet.ownerNode as Element | null)?.id === STYLE_ID) continue;
    try {
      css.push(...rewrite(sheet.cssRules));
    } catch {
      /* cross-origin stylesheet: its rules can't be read */
    }
  }
  let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement('style');
    style.id = STYLE_ID;
    (doc.head ?? doc.documentElement).appendChild(style);
  }
  style.textContent = css.join('\n');
  builtFor = doc.styleSheets.length;
}

/** Dispatches the events a mouse moving onto `el` would: enter for newly entered ancestors, then over/move. */
function dispatchHoverEvents(el: Element) {
  const view = el.ownerDocument.defaultView ?? window;
  const r = el.getBoundingClientRect();
  const point = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
  const ancestors: Element[] = [];
  for (let n: Element | null = el; n; n = n.parentElement) ancestors.unshift(n);
  for (const n of ancestors) {
    if (chain.includes(n)) continue; // the pointer is already inside it
    n.dispatchEvent(new PointerEvent('pointerenter', { ...point, view, pointerType: 'mouse', isPrimary: true, bubbles: false }));
    n.dispatchEvent(new MouseEvent('mouseenter', { ...point, view, bubbles: false }));
  }
  const base = { ...point, view, bubbles: true, cancelable: true, composed: true };
  el.dispatchEvent(new PointerEvent('pointerover', { ...base, pointerType: 'mouse', isPrimary: true }));
  el.dispatchEvent(new MouseEvent('mouseover', base));
  el.dispatchEvent(new PointerEvent('pointermove', { ...base, pointerType: 'mouse', isPrimary: true }));
  el.dispatchEvent(new MouseEvent('mousemove', base));
}

/** Leaves elements no longer under the pointer, as a real mouse would. */
function leave(next: Element | null) {
  const keep = new Set<Element>();
  for (let n: Element | null = next; n; n = n.parentElement) keep.add(n);
  for (const n of [...chain].reverse()) {
    if (keep.has(n)) continue;
    n.classList.remove(HOVER_CLASS);
    n.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse', bubbles: false }));
    n.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
  }
}

/** Puts the (emulated) pointer on `el`. */
export function hoverOn(el: Element) {
  syncHoverStyles(el.ownerDocument);
  leave(el);
  dispatchHoverEvents(el);
  const next: Element[] = [];
  for (let n: Element | null = el; n; n = n.parentElement) {
    n.classList.add(HOVER_CLASS);
    next.push(n);
  }
  chain = next;
  // Keyboard-friendly menus also open on focus (:focus-within).
  if (isHTML(el) && el.tabIndex >= 0) el.focus({ preventScroll: true });
}

/** A click outside the hovered menu moves the pointer away: the menu closes. */
export function releaseHoverUnlessInside(target: Element) {
  if (!chain.length) return;
  if (chain.some((n) => n !== document.documentElement && n !== document.body && n.contains(target))) return;
  leave(null);
  chain = [];
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

async function settleBriefly() {
  // Menus animate; give them a few frames and a moment for lazy content.
  await sleep(260);
}

function newlyVisible(before: Set<Element>): Element[] {
  return collectInteractive().elements.filter((e) => !before.has(e));
}

const describeAll = (els: Element[], max = 40): ElementInfo[] => els.slice(0, max).map(describeElement);

export async function hover(el: Element, show: boolean): Promise<HoverResult> {
  el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' as ScrollBehavior });
  if (show) highlight(el, 'Hovering');
  const before = new Set(collectInteractive().elements);
  hoverOn(el);
  await settleBriefly();
  return { element: { name: accessibleName(el), role: roleOf(el) }, revealed: describeAll(newlyVisible(before)) };
}

/** Menu buttons open on click; a plain link at the top of a menu would navigate instead. */
function opensOnClick(el: Element): boolean {
  if (el.hasAttribute('aria-haspopup') || el.hasAttribute('aria-expanded')) return true;
  if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || el.getAttribute('role') === 'menuitem') return true;
  if (isAnchor(el)) {
    const href = el.getAttribute('href') ?? '';
    return href === '' || href === '#' || href.startsWith('javascript:');
  }
  return false;
}

/** Explicitly marked as opening a menu. */
const isMenuButton = (el: Element) => el.hasAttribute('aria-haspopup') || el.hasAttribute('aria-expanded');

function bestMatch(candidates: Element[], label: string): Element | null {
  const want = norm(label);
  if (!want) return null;
  const scored = candidates
    .map((el) => {
      const name = norm(accessibleName(el));
      const score = name === want ? 3 : name.startsWith(want) ? 2 : name.includes(want) ? 1 : 0;
      return { el, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.el ?? null;
}

/**
 * Opens nested menus along `path` (e.g. ["Products", "Laptops"]). Each label is looked for
 * first among the items the previous level revealed. Returns what the last level shows.
 */
export async function openMenu(path: string[], show: boolean): Promise<MenuResult> {
  const opened: string[] = [];
  let scope: Element[] | null = null;
  for (const [level, label] of path.entries()) {
    const last = level === path.length - 1;
    const all = collectInteractive().elements;
    const target = (scope?.length ? bestMatch(scope, label) : null) ?? bestMatch(all, label);
    if (!target) {
      return { opened, failedAt: label, revealed: [], options: describeAll(scope?.length ? scope : all, 30) };
    }
    target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' as ScrollBehavior });
    if (show) highlight(target, 'Opening');
    const before = new Set(all);
    hoverOn(target);
    await settleBriefly();
    let revealed = newlyVisible(before);
    // Only menu buttons are clicked here. The last label may be the item the user wants —
    // that click goes through the click tool, so approvals still apply.
    const clickable = last ? isMenuButton(target) : opensOnClick(target);
    if (!revealed.length && clickable && isHTML(target)) {
      target.click();
      await settleBriefly();
      revealed = newlyVisible(before);
    }
    if (last && !revealed.length) {
      return { opened, revealed: [], item: describeElement(target) };
    }
    opened.push(accessibleName(target) || label);
    scope = revealed;
  }
  return { opened, revealed: describeAll(scope ?? []) };
}

/** Is the emulated pointer on this element (its hover menu open)? */
export const isHovered = (el: Element) => chain.includes(el);

/** Hovers a menu trigger and returns the items that appeared. */
export async function openHoverMenu(el: Element): Promise<ElementInfo[]> {
  const before = new Set(collectInteractive().elements);
  hoverOn(el);
  await settleBriefly();
  return describeAll(newlyVisible(before));
}
