import { isHTML, isInput, isSelect, isTextArea } from './dom';
/**
 * Element discovery for the page-understanding layer: which elements a person could
 * interact with, what they are called (a pragmatic subset of the accessible-name
 * algorithm), and a stable numeric id per element for the life of the document.
 * Ids live in a WeakMap — the page's DOM is never modified.
 */

const ids = new WeakMap<Element, number>();
const refs = new Map<number, WeakRef<Element>>();
// Each document starts at a different base, so an id from a page that is gone can't
// silently point at a different element on the next page.
let nextId = 1000 + Math.floor(Math.random() * 90) * 100;

export const OVERLAY_HOST_ID = '__web-agent-overlay__';

/** This document's identity: the content script runs once per document. */
export const DOC_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function idFor(el: Element): number {
  let id = ids.get(el);
  if (id === undefined) {
    id = nextId++;
    ids.set(el, id);
    refs.set(id, new WeakRef(el));
  }
  return id;
}

/** The element for an id, or null when it no longer exists in the document. */
export function elementFor(id: number): Element | null {
  const el = refs.get(id)?.deref() ?? null;
  if (!el || !el.isConnected) {
    refs.delete(id);
    return null;
  }
  return el;
}

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'option', 'combobox', 'textbox', 'searchbox', 'slider', 'spinbutton', 'treeitem', 'gridcell', 'listbox',
]);

const NATIVE_INTERACTIVE = new Set(['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'SUMMARY', 'OPTION']);

/** Tags worth checking for `cursor: pointer` — clickable divs and spans in modern apps. */
const POINTER_CANDIDATES = new Set(['A', 'B', 'STRONG', 'FONT', 'DIV', 'SPAN', 'LI', 'IMG', 'svg', 'I', 'TD', 'TR', 'LABEL', 'P', 'H1', 'H2', 'H3', 'H4', 'SECTION', 'ARTICLE']);

export function isExplicitlyInteractive(el: Element): boolean {
  const tag = el.tagName;
  if (NATIVE_INTERACTIVE.has(tag)) {
    if (tag === 'A') return el.hasAttribute('href') || el.getAttribute('role') === 'button';
    if (tag === 'INPUT') return (el as HTMLInputElement).type !== 'hidden';
    return true;
  }
  const role = el.getAttribute('role');
  if (role && INTERACTIVE_ROLES.has(role)) return true;
  if (isHTML(el) && el.isContentEditable && !el.parentElement?.isContentEditable) return true;
  const tabindex = el.getAttribute('tabindex');
  if (tabindex !== null && tabindex !== '-1' && !Number.isNaN(Number(tabindex))) return true;
  if (el.hasAttribute('onclick')) return true;
  return false;
}

export function isVisible(el: Element): boolean {
  if (el.id === OVERLAY_HOST_ID) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1 || (isInput(el) && el.type !== 'checkbox' && el.type !== 'radio' && (rect.width < 4 || rect.height < 4))) {
    // Visually-hidden native inputs (custom checkboxes) are still operable through their label.
    return false;
  }
  if ('checkVisibility' in el) {
    return (el as HTMLElement).checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  }
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0;
}

export function inViewport(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
}

const clean = (s: string | null | undefined, max = 90): string => {
  if (!s) return '';
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

function textOf(el: Element): string {
  return clean((el as HTMLElement).innerText ?? el.textContent);
}

function byIds(el: Element, attr: string): string {
  const idList = el.getAttribute(attr);
  if (!idList) return '';
  const root = el.getRootNode() as Document | ShadowRoot;
  return clean(
    idList
      .split(/\s+/)
      .map((id) => root.getElementById?.(id)?.textContent ?? '')
      .join(' '),
  );
}

export function roleOf(el: Element): string {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;
  const tag = el.tagName;
  if (tag === 'A') return 'link';
  if (tag === 'BUTTON' || tag === 'SUMMARY') return 'button';
  if (tag === 'SELECT') return (el as HTMLSelectElement).multiple ? 'listbox' : 'select';
  if (tag === 'TEXTAREA') return 'textbox';
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'range') return 'slider';
    if (type === 'number') return 'spinbutton';
    if (type === 'search') return 'searchbox';
    return 'textbox';
  }
  if (isHTML(el) && el.isContentEditable) return 'textbox';
  if (tag === 'IMG') return 'image';
  return 'clickable';
}

export function accessibleName(el: Element): string {
  const labelled = byIds(el, 'aria-labelledby');
  if (labelled) return labelled;
  const aria = clean(el.getAttribute('aria-label'));
  if (aria) return aria;

  if (isInput(el) || isTextArea(el) || isSelect(el)) {
    const labels = Array.from(el.labels ?? []).map((l) => textOf(l)).filter(Boolean);
    if (labels.length) return clean(labels.join(' '));
    if (isInput(el) && ['button', 'submit', 'reset'].includes(el.type) && el.value) return clean(el.value);
    if (isInput(el) && el.type === 'image') return clean(el.alt || el.value || el.title) || iconName(el) || 'Submit';
    // Older forms lay out label and field in table cells: <td>Take:</td><td><input></td>.
    const cellLabel = tableLabel(el);
    if (cellLabel) return cellLabel;
    const placeholder = clean(el.getAttribute('placeholder'));
    if (placeholder) return placeholder;
    const title = clean(el.getAttribute('title'));
    if (title) return title;
    const columnLabel = neighbourLabel(el);
    if (columnLabel) return columnLabel;
    // A label-like sibling right before the field ("Name" <input>) is common in hand-built forms.
    const prev = el.previousElementSibling;
    if (prev && ['LABEL', 'SPAN', 'DIV', 'P'].includes(prev.tagName)) {
      const t = textOf(prev);
      if (t && t.length < 50) return t;
    }
    return clean(el.getAttribute('name') ?? el.id ?? '');
  }

  if (el.tagName === 'IMG') return clean((el as HTMLImageElement).alt || el.getAttribute('title')) || iconName(el);

  const text = textOf(el);
  if (text) return text;

  const title = clean(el.getAttribute('title'));
  if (title) return title;
  // Icon-only buttons: an <img alt>, an <svg><title>, or a labelled child.
  const img = el.querySelector('img[alt]');
  if (img) return clean(img.getAttribute('alt'));
  const svgTitle = el.querySelector('svg title');
  if (svgTitle?.textContent) return clean(svgTitle.textContent);
  const labelledChild = el.querySelector('[aria-label]');
  if (labelledChild) return clean(labelledChild.getAttribute('aria-label'));
  const tooltip = tooltipOf(el) || tooltipOf(el.querySelector(`[title],${TOOLTIP_ATTRS.map((a) => `[${a}]`).join(',')}`));
  return tooltip || iconName(el);
}

const FIELDS = 'input:not([type=hidden]),select,textarea,button,[role=combobox],[contenteditable=true]';

/** “Frequency: *” → “Frequency”. */
const asLabel = (text: string) => text.replace(/[\s:*]+$/, '').replace(/^[\s*]+/, '').trim();

/** The text of the cell before the field's cell, in the same table row (skipping empty cells). */
function tableLabel(el: Element): string {
  const cell = el.closest('td,th');
  if (!cell) return '';
  let prev = cell.previousElementSibling;
  for (let i = 0; prev && i < 3; i++, prev = prev.previousElementSibling) {
    if (prev.querySelector(FIELDS)) return '';
    const text = asLabel(textOf(prev));
    if (text) return text.length <= 40 ? text : '';
  }
  return '';
}

/** Grid layouts: <div><span>Take</span></div><div><input></div> — a short text box right before the field's box. */
function neighbourLabel(el: Element): string {
  let box = el.parentElement;
  for (let depth = 0; box && depth < 2; depth++, box = box.parentElement) {
    if (box.querySelectorAll(FIELDS).length > 1) return '';
    const prev = box.previousElementSibling;
    if (prev && !prev.querySelector(FIELDS) && !prev.matches(FIELDS)) {
      const text = asLabel(textOf(prev));
      if (text && text.length <= 40) return text;
    }
  }
  return '';
}

/** Tooltip libraries move `title` into these (Bootstrap: data-original-title / data-bs-original-title). */
const TOOLTIP_ATTRS = ['data-original-title', 'data-bs-original-title', 'data-bs-title', 'data-tooltip', 'data-title', 'data-tip', 'data-hint', 'data-balloon'];

function tooltipOf(el: Element | null): string {
  if (!el) return '';
  for (const attr of ['title', ...TOOLTIP_ATTRS]) {
    const v = clean(el.getAttribute(attr));
    if (v) return v;
  }
  return '';
}

const ICON_CLASS = /^(?:fa[srldbtk]?|fa-solid|glyphicon|bi|icon|icons?|ti|la[srb]?|mdi|ion|ionicons?|ri|bx|bxs|feather|lni|zmdi|oi|typcn|si|material-icons|ki|flaticon)-([a-z][a-z0-9-]*)$/i;
const ICON_MODIFIER = /^(lg|xs|sm|xl|[0-9]+x|fw|spin|pulse|border|inverse|solid|regular|light|thin|duotone|brands|sharp|li|ul|stack(-[0-9]x)?|pull-.*|flip-.*|rotate-.*|beat|fade|bounce|shake|outline|filled|round|rounded|line|fill)$/i;
const IGNORED_CALLS = new Set(['return', 'javascript', 'void', 'function', 'if', 'event', 'this', 'window', 'document', 'location', 'false', 'true', 'setTimeout', 'preventDefault', 'stopPropagation']);

/** "OpenBookAppointment" / "book_appt" / "user-edit" → "open book appointment" / "book appt" / "user edit". */
const words = (s: string) =>
  s
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/**
 * A best-effort name for an icon-only control with no label at all: the function its
 * onclick calls, the page its link opens, its image file, or its icon-font class.
 * Shown as “… (icon)” so the agent knows it is inferred.
 */
function iconName(el: Element): string {
  const handler = el.getAttribute('onclick') ?? '';
  const href = el.getAttribute('href') ?? '';
  const code = `${handler} ${/^javascript:/i.test(href) ? href.slice(11) : ''}`;
  const calls = Array.from(code.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g), (m) => m[1].split('.').pop() ?? '').filter(
    (f) => f.length > 2 && !IGNORED_CALLS.has(f),
  );
  const strings = Array.from(code.matchAll(/(['"])([^'"]{3,200})\1/g), (m) => m[2]);
  const candidates = [
    // bookAppointment(4) — a descriptive function name says what the icon does…
    ...calls.filter((f) => words(f).includes(' ') && !GENERIC_CALL.test(words(f))).map(words),
    // …unlike openWindow('Appointments/Book.aspx') or __doPostBack('ctl00$grid$lnkBook'), where the argument does.
    ...strings.map((v) => (/[/.](aspx?|php|html?|jsp|do)\b|\//i.test(v) ? pathWords(v) : controlWords(v))),
    controlWords(el.id),
    href && !/^(javascript:|#)/i.test(href) ? pathWords(href) : '',
    ...pictureNames(el),
    ...calls.filter((f) => !GENERIC_CALL.test(words(f)) && !HELPER_CALL.test(f)).map(words),
  ];
  const name = candidates.find((c) => /[a-z]{3}/.test(c));
  return name ? `${name} (icon)` : '';
}

/** Helpers that only open or show something — their name says nothing about the action. */
const GENERIC_CALL = /^(open|show|load|go|goto|call|do|run|submit|post|popup|redirect|navigate|window|modal|dialog|url|page|link|click|handle|on|fn|func|action|ajax|get|set)( (window|popup|pop up|modal|dialog|url|page|link|click|action|post back|form|new window|in new tab|tab|frame|iframe|win))*$/;
const HELPER_CALL = /^(say|log|alert|confirm|prompt|go|fn|cb|f|h)$/i;

/** "/Appointments/BookAppointment.aspx?id=4" → "book appointment". */
function pathWords(url: string): string {
  const seg = url.split(/[?#]/)[0].split('/').filter(Boolean).pop() ?? '';
  const w = words(seg);
  return /^\d+$/.test(seg) || /^(index|default|home|void 0|)$/.test(w) ? '' : w;
}

/** "ctl00_Main_grid_ctl03_lnkBookAppt" / "btnPrintLabel" → "book appt" / "print label". Skips generated ids. */
function controlWords(id: string): string {
  const last = id.split(/[_$:]/).filter((part) => /[a-z]{3}/i.test(part) && !/^ctl\d*$/i.test(part)).pop() ?? '';
  if (!last || /\d{3}|^[a-z]{1,3}\d|^(ember|react|radix|mui|ext|el|id|rc|r|w)[-\d]/i.test(last) || /^[0-9a-f-]{8,}$/i.test(last)) return '';
  return words(last.replace(/^(lnk|lb|btn|img|imgbtn|ib|hl|cmd|link|button|icon|ico)(?=[A-Z])/, ''));
}

/** Names from the icon's picture: image file, SVG sprite id, icon-font class. */
function pictureNames(el: Element): string[] {
  const out: string[] = [];
  for (const node of [el, ...Array.from(el.querySelectorAll('img,i,span,svg,use,em'))].slice(0, 6)) {
    const src = node.tagName === 'IMG' || isInput(node) ? node.getAttribute('src') ?? '' : '';
    if (src && !src.startsWith('data:')) {
      const file = src.split(/[?#]/)[0].split('/').pop() ?? '';
      if (!/[0-9a-f]{12}/.test(file)) out.push(words(file).replace(/\b(icon|ico|img|btn|image|small|large|\d+)\b/g, '').replace(/\s+/g, ' ').trim());
    }
    const use = node.tagName.toLowerCase() === 'use' ? node.getAttribute('href') ?? node.getAttribute('xlink:href') ?? '' : '';
    if (use.includes('#')) out.push(words(use.split('#').pop()!.replace(/^(icon|ico|i)[-_]/i, '')));
    for (const cls of Array.from(node.classList ?? [])) {
      const m = ICON_CLASS.exec(cls);
      if (m && !ICON_MODIFIER.test(m[1])) out.push(words(m[1].replace(/-o$/, '')));
    }
  }
  return out;
}

/** Dialog, form or table-row context, so the agent can tell similar elements apart. */
export function contextOf(el: Element): string | undefined {
  const dialog = el.closest('dialog,[role=dialog],[role=alertdialog],[aria-modal=true]');
  if (dialog) {
    const title = byIds(dialog, 'aria-labelledby') || clean(dialog.getAttribute('aria-label')) || clean(dialog.querySelector('h1,h2,h3,[class*=title]')?.textContent, 50);
    return title ? `dialog “${title}”` : 'dialog';
  }
  const row = el.closest('tr,[role=row]');
  if (row) {
    const table = row.closest('table,[role=table],[role=grid]');
    const rows = table ? Array.from(table.querySelectorAll('tr,[role=row]')) : [];
    const index = rows.indexOf(row);
    const header = table?.querySelector('thead tr, [role=row]:has([role=columnheader])');
    const position = header ? index : index + 1;
    const cells = Array.from(row.querySelectorAll(':scope > td, :scope > th, [role=gridcell], [role=cell]'))
      .map((c) => clean(c.textContent, 40))
      .filter((t) => t && t.length < 40)
      .slice(0, 3);
    const lead = clean(cells.join(' · '), 80);
    if (index >= 0 && row !== header) return `row ${position}${lead ? ` “${lead}”` : ''}`;
  }
  const form = el.closest('form');
  if (form) {
    const name = clean(form.getAttribute('aria-label') ?? form.getAttribute('name'), 40) || clean(form.querySelector('legend,h1,h2,h3')?.textContent, 40);
    if (name) return `form “${name}”`;
  }
  return undefined;
}

export function isDisabled(el: Element): boolean {
  if ((el as HTMLButtonElement).disabled) return true;
  if (el.getAttribute('aria-disabled') === 'true') return true;
  return !!el.closest('fieldset[disabled]');
}

export function isEditable(el: Element): el is HTMLInputElement | HTMLTextAreaElement | HTMLElement {
  if (isTextArea(el)) return !el.readOnly;
  if (isInput(el)) {
    const nonText = ['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'range', 'color', 'hidden'];
    return !nonText.includes(el.type) && !el.readOnly;
  }
  return isHTML(el) && el.isContentEditable;
}

export interface Root {
  root: Document | ShadowRoot;
  frameLabel?: string;
}

/**
 * Walks the document, open shadow roots and same-origin iframes, yielding every element
 * a person could operate. Bounded so huge pages stay fast.
 */
export function collectInteractive(limitNodes = 20000): { elements: Element[]; frames: string[] } {
  const found: Element[] = [];
  const frames: string[] = [];
  let visited = 0;

  const visit = (root: Document | ShadowRoot | Element) => {
    const doc = root instanceof Document ? root : (root.ownerDocument ?? document);
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode() as Element | null;
    while (node && visited < limitNodes) {
      visited++;
      const el = node;
      if (el.id === OVERLAY_HOST_ID) {
        node = walker.nextSibling() as Element | null;
        // Skip the overlay subtree entirely.
        if (!node) node = walker.nextNode() as Element | null;
        continue;
      }
      if (isExplicitlyInteractive(el)) {
        if (isVisible(el) || isOperableHiddenInput(el)) found.push(el);
      } else if (POINTER_CANDIDATES.has(el.tagName) && isPointerClickable(el)) {
        found.push(el);
      }
      if (el.shadowRoot) visit(el.shadowRoot);
      if (el.tagName === 'IFRAME') {
        try {
          const doc = (el as HTMLIFrameElement).contentDocument;
          if (doc?.body && isVisible(el)) visit(doc.body);
          else if (!doc) frames.push(frameHost(el as HTMLIFrameElement));
        } catch {
          frames.push(frameHost(el as HTMLIFrameElement));
        }
      }
      node = walker.nextNode() as Element | null;
    }
  };

  visit(document.body ?? document.documentElement);
  return { elements: found, frames: frames.filter(Boolean) };
}

function frameHost(frame: HTMLIFrameElement): string {
  try {
    return new URL(frame.src, location.href).host;
  } catch {
    return '';
  }
}

/** Custom checkboxes/radios hide the real input; it is still operable. */
function isOperableHiddenInput(el: Element): boolean {
  if (!(isInput(el)) || !['checkbox', 'radio'].includes(el.type)) return false;
  const label = el.labels?.[0] ?? el.parentElement;
  return !!label && isVisible(label);
}

function isPointerClickable(el: Element): boolean {
  const parent = el.parentElement;
  if (!parent) return false;
  // Only the outermost clickable box: skip when an ancestor is already interactive or pointer.
  if (parent.closest('a[href],button,[role=button],[role=link],[role=option],[role=menuitem],[role=tab],label')) return false;
  const style = getComputedStyle(el);
  if (style.cursor !== 'pointer') return false;
  if (getComputedStyle(parent).cursor === 'pointer') return false;
  if (!isVisible(el)) return false;
  const name = accessibleName(el);
  return name.length > 0 && name.length < 120;
}

const MENU_ITEMS = 'a[href], button, [role=menuitem], [role=option], [role=link]';
const MENU_HOST = 'li, [role=menuitem], [role=none], [class*="dropdown"], [class*="menu-item"], [class*="nav-item"]';

/**
 * Holds a sub-menu that is hidden right now — a hover (or click) menu trigger such as
 * “Patients” in a navigation bar. Marked with aria-haspopup, or its list item contains
 * hidden menu items.
 */
export function hasHiddenMenu(el: Element): boolean {
  const popup = el.getAttribute('aria-haspopup');
  if (popup && popup !== 'false' && el.getAttribute('aria-expanded') !== 'true') return true;
  // <a>Patients</a><ul class="…">…</ul> — a hidden list right next to the trigger (or its wrapper).
  const hiddenSiblingMenu = (node: Element | null) =>
    !!node?.parentElement &&
    Array.from(node.parentElement.children).some((sib) => sib !== node && !isVisible(sib) && sib.querySelectorAll(MENU_ITEMS).length >= 2);
  if (hiddenSiblingMenu(el) || (el.parentElement && el.parentElement.children.length === 1 && hiddenSiblingMenu(el.parentElement))) return true;
  const host = el.closest(MENU_HOST);
  if (!host || host === document.body) return false;
  const items = host.querySelectorAll(MENU_ITEMS);
  if (items.length > 120) return false; // a whole page section, not a menu
  let hidden = 0;
  for (const item of Array.from(items)) {
    if (item === el || el.contains(item) || item.contains(el)) continue;
    if (!isVisible(item) && ++hidden >= 2) return true;
  }
  return false;
}
