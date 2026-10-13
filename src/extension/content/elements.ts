/**
 * Element discovery for the page-understanding layer: which elements a person could
 * interact with, what they are called (a pragmatic subset of the accessible-name
 * algorithm), and a stable numeric id per element for the life of the document.
 * Ids live in a WeakMap — the page's DOM is never modified.
 */

const ids = new WeakMap<Element, number>();
const refs = new Map<number, WeakRef<Element>>();
let nextId = 1;

export const OVERLAY_HOST_ID = '__web-agent-overlay__';

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
const POINTER_CANDIDATES = new Set(['DIV', 'SPAN', 'LI', 'IMG', 'svg', 'I', 'TD', 'TR', 'LABEL', 'P', 'H1', 'H2', 'H3', 'H4', 'SECTION', 'ARTICLE']);

export function isExplicitlyInteractive(el: Element): boolean {
  const tag = el.tagName;
  if (NATIVE_INTERACTIVE.has(tag)) {
    if (tag === 'A') return el.hasAttribute('href') || el.getAttribute('role') === 'button';
    if (tag === 'INPUT') return (el as HTMLInputElement).type !== 'hidden';
    return true;
  }
  const role = el.getAttribute('role');
  if (role && INTERACTIVE_ROLES.has(role)) return true;
  if (el instanceof HTMLElement && el.isContentEditable && !el.parentElement?.isContentEditable) return true;
  const tabindex = el.getAttribute('tabindex');
  if (tabindex !== null && tabindex !== '-1' && !Number.isNaN(Number(tabindex))) return true;
  if (el.hasAttribute('onclick')) return true;
  return false;
}

export function isVisible(el: Element): boolean {
  if (el.id === OVERLAY_HOST_ID) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) {
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
  if (el instanceof HTMLElement && el.isContentEditable) return 'textbox';
  if (tag === 'IMG') return 'image';
  return 'clickable';
}

export function accessibleName(el: Element): string {
  const labelled = byIds(el, 'aria-labelledby');
  if (labelled) return labelled;
  const aria = clean(el.getAttribute('aria-label'));
  if (aria) return aria;

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    const labels = Array.from(el.labels ?? []).map((l) => textOf(l)).filter(Boolean);
    if (labels.length) return clean(labels.join(' '));
    if (el instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(el.type) && el.value) return clean(el.value);
    if (el instanceof HTMLInputElement && el.type === 'image') return clean(el.alt || el.value || 'Submit');
    const placeholder = clean(el.getAttribute('placeholder'));
    if (placeholder) return placeholder;
    const title = clean(el.getAttribute('title'));
    if (title) return title;
    // A label-like sibling right before the field ("Name" <input>) is common in hand-built forms.
    const prev = el.previousElementSibling;
    if (prev && ['LABEL', 'SPAN', 'DIV', 'P'].includes(prev.tagName)) {
      const t = textOf(prev);
      if (t && t.length < 50) return t;
    }
    return clean(el.getAttribute('name') ?? el.id ?? '');
  }

  if (el.tagName === 'IMG') return clean((el as HTMLImageElement).alt || el.getAttribute('title'));

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
  const tooltip = clean(el.getAttribute('data-tooltip') ?? el.getAttribute('data-title'));
  return tooltip;
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
    const first = clean(row.querySelector('td,[role=gridcell],[role=cell]')?.textContent, 40);
    if (index >= 0 && row !== header) return `row ${position}${first ? ` “${first}”` : ''}`;
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
  if (el instanceof HTMLTextAreaElement) return !el.readOnly;
  if (el instanceof HTMLInputElement) {
    const nonText = ['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'range', 'color', 'hidden'];
    return !nonText.includes(el.type) && !el.readOnly;
  }
  return el instanceof HTMLElement && el.isContentEditable;
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
  if (!(el instanceof HTMLInputElement) || !['checkbox', 'radio'].includes(el.type)) return false;
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
