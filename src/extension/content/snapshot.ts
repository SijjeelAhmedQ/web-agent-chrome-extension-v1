import type { DialogInfo, ElementInfo, ElementRisk, PageSnapshot, ReadMode } from '@/shared/types/page';
import type { FindResult, TextResult } from '../messaging/protocol';
import {
  accessibleName,
  collectInteractive,
  contextOf,
  idFor,
  inViewport,
  isVisible,
  OVERLAY_HOST_ID,
  hasHiddenMenu,
  isDisabled,
  roleOf,
} from './elements';
import { isAnchor, isButton, isHTML, isInput, isSelect, isTextArea } from './dom';

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export function describeElement(el: Element): ElementInfo {
  const role = roleOf(el);
  const info: ElementInfo = {
    id: idFor(el),
    role,
    name: accessibleName(el),
    tag: el.tagName.toLowerCase(),
    inViewport: inViewport(el),
  };
  if (isInput(el)) {
    info.type = el.type;
    if (el.type === 'checkbox' || el.type === 'radio') info.checked = el.checked;
    else if (el.type === 'password') info.value = el.value ? '••••' : '';
    else if (!['button', 'submit', 'reset', 'image'].includes(el.type)) info.value = clip(el.value, 120);
    if (el.placeholder && el.placeholder !== info.name) info.placeholder = clip(el.placeholder, 60);
    if (el.required) info.required = true;
    if (el.readOnly && !['button', 'submit', 'reset', 'image', 'checkbox', 'radio'].includes(el.type)) info.readonly = true;
  } else if (isTextArea(el)) {
    info.value = clip(el.value, 200);
    if (el.placeholder && el.placeholder !== info.name) info.placeholder = clip(el.placeholder, 60);
    if (el.required) info.required = true;
  } else if (isSelect(el)) {
    info.value = el.selectedOptions[0]?.text.trim() ?? '';
    const options = Array.from(el.options).map((o) => o.text.trim()).filter(Boolean);
    info.options = options.length > 25 ? [...options.slice(0, 25), `…${options.length - 25} more`] : options;
    if (el.required) info.required = true;
  } else if (isButton(el)) {
    info.type = el.type;
  } else if (isAnchor(el) && el.href) {
    info.href = shortHref(el.href);
  } else if (isHTML(el) && el.isContentEditable) {
    info.value = clip((el.innerText ?? '').trim(), 200);
  }

  const ariaChecked = el.getAttribute('aria-checked');
  if (ariaChecked) info.checked = ariaChecked === 'true';
  const ariaSelected = el.getAttribute('aria-selected');
  if (ariaSelected === 'true') info.selected = true;
  const ariaExpanded = el.getAttribute('aria-expanded');
  if (ariaExpanded) info.expanded = ariaExpanded === 'true';
  if (['link', 'button', 'clickable', 'menuitem'].includes(role) && hasHiddenMenu(el)) info.hasMenu = true;
  if (isDisabled(el)) info.disabled = true;
  if (role === 'combobox' && !info.value) {
    const input = el.matches('input') ? (el as HTMLInputElement) : el.querySelector('input');
    const shown = (el as HTMLElement).innerText?.trim();
    if (input?.value) info.value = clip(input.value, 80);
    else if (shown && shown !== info.name) info.value = clip(shown, 80);
  }
  const context = contextOf(el);
  if (context) info.context = context;
  const popup = blockingPopupOf(el);
  if (popup) info.inBlockingPopup = popup;
  return info;
}

/** For a text field inside a pop-up with no way to close it: the pop-up's title. */
function blockingPopupOf(el: Element): string | null {
  const texty = (isInput(el) && !['button', 'submit', 'reset', 'image', 'checkbox', 'radio', 'hidden', 'file', 'range', 'color'].includes(el.type)) || isTextArea(el) || (isHTML(el) && el.isContentEditable);
  if (!texty) return null;
  let dialog = el.closest(DIALOGS);
  if (!dialog) return null;
  for (let outer = dialog.parentElement?.closest(DIALOGS); outer; outer = outer.parentElement?.closest(DIALOGS)) dialog = outer;
  return closeControl(dialog) ? null : dialogTitle(dialog) || 'Pop-up';
}

function shortHref(href: string): string {
  try {
    const u = new URL(href);
    if (u.protocol === 'javascript:') return '';
    const sameHost = u.host === location.host;
    const path = `${u.pathname}${u.search}`.replace(/\/$/, '') || '/';
    return clip(sameHost ? path : `${u.host}${path === '/' ? '' : path}`, 80);
  } catch {
    return '';
  }
}

function scrollState() {
  const se = document.scrollingElement ?? document.documentElement;
  const max = Math.max(0, se.scrollHeight - innerHeight);
  const percent = max > 0 ? Math.round((se.scrollTop / max) * 100) : 0;
  return {
    percent,
    screens: Math.max(1, Math.round((se.scrollHeight / Math.max(1, innerHeight)) * 10) / 10),
    atTop: se.scrollTop <= 2,
    atBottom: se.scrollTop >= max - 2,
  };
}

function headings(): string[] {
  return Array.from(document.querySelectorAll('h1,h2,h3,[role=heading]'))
    .filter((h) => (h as HTMLElement).offsetParent !== null || h.getClientRects().length > 0)
    .map((h) => {
      const level = Number(h.tagName[1]) || Number(h.getAttribute('aria-level')) || 2;
      const text = (h as HTMLElement).innerText?.replace(/\s+/g, ' ').trim() ?? '';
      return text ? `${'#'.repeat(Math.min(level, 3))} ${clip(text, 100)}` : '';
    })
    .filter(Boolean)
    .slice(0, 30);
}

/** Rendered text of the page's main region (falls back to the body). */
function pageText(maxChars: number): { text: string; truncated: boolean } {
  const dialog = Array.from(document.querySelectorAll<HTMLElement>('dialog[open],[role=dialog],[aria-modal=true]')).find((d) => d.getClientRects().length > 0);
  const main = document.querySelector<HTMLElement>('main,[role=main]');
  const root = dialog ?? (main && (main.innerText?.length ?? 0) > 200 ? main : document.body);
  const raw = (root?.innerText ?? '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
  return raw.length > maxChars ? { text: raw.slice(0, maxChars), truncated: true } : { text: raw, truncated: false };
}

/** Pop-ups that cover the page: native dialogs, ARIA dialogs, Bootstrap and jQuery UI modals. */
export const DIALOGS = 'dialog[open],[role=dialog],[role=alertdialog],[aria-modal=true],.modal.show,.modal.in,.ui-dialog';

const CLOSE_NAME = /^(×|✕|✖|╳|x|close|cancel|dismiss|close dialog|close window)$/i;
const CLOSE_CLASS = /(^|\s)(close|btn-close|ui-dialog-titlebar-close|modal-close)(\s|$)/i;

/** The × / Close / Cancel control of a dialog, if it has one. */
function closeControl(dialog: Element): Element | null {
  const candidates = dialog.querySelectorAll(
    'button,a,[role=button],input[type=button],input[type=submit],input[type=reset],.close,.btn-close,.ui-dialog-titlebar-close,[data-dismiss],[data-bs-dismiss],[aria-label],[title]',
  );
  for (const el of Array.from(candidates)) {
    if (!isVisible(el)) continue;
    const name = accessibleName(el).trim();
    const cls = typeof el.className === 'string' ? el.className : '';
    if (CLOSE_NAME.test(name) || CLOSE_CLASS.test(cls) || el.hasAttribute('data-dismiss') || el.hasAttribute('data-bs-dismiss')) return el;
  }
  return null;
}

function dialogTitle(dialog: Element): string {
  const labelled = dialog.getAttribute('aria-labelledby');
  const byId = labelled ? labelled.split(/\s+/).map((id) => dialog.ownerDocument.getElementById(id)?.textContent ?? '').join(' ') : '';
  const heading = dialog.querySelector('.modal-title,.ui-dialog-title,[class*="title"],h1,h2,h3,h4,legend,b,strong')?.textContent ?? '';
  const first = ((dialog as HTMLElement).innerText ?? '').split('\n').find((l) => l.trim()) ?? '';
  return clip((byId || dialog.getAttribute('aria-label') || heading || first).replace(/\s+/g, ' ').trim(), 90);
}

/** The pop-ups showing now, outermost first, each with its close control. */
export function showingDialogs(): DialogInfo[] {
  return Array.from(document.querySelectorAll(DIALOGS))
    .filter((d) => isVisible(d) && !d.parentElement?.closest(DIALOGS))
    .slice(0, 4)
    .map((d) => {
      const close = closeControl(d);
      return { title: dialogTitle(d), text: clip(((d as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim(), 220), close: close ? describeElement(close) : null };
    });
}

export function snapshot(mode: ReadMode, maxElements: number, maxTextChars: number): PageSnapshot {
  const { elements, frames } = collectInteractive();
  const described = elements.map(describeElement);
  // Prefer what is on screen, then the rest in document order.
  const visible = described.filter((e) => e.inViewport);
  const rest = described.filter((e) => !e.inViewport);
  const chosen = [...visible, ...rest].slice(0, maxElements);
  const order = new Map(described.map((e, i) => [e.id, i]));
  chosen.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  const textBudget = mode === 'content' ? maxTextChars : Math.min(2500, maxTextChars);
  const { text, truncated } = pageText(textBudget);
  return {
    url: location.href,
    title: document.title,
    scroll: scrollState(),
    elements: chosen,
    omitted: described.length - chosen.length,
    headings: headings(),
    text,
    textTruncated: truncated,
    frames,
    dialogOpen: Array.from(document.querySelectorAll('dialog[open],[role=dialog]:not([aria-hidden=true]),[aria-modal=true]')).some((d) => isVisible(d)),
    dialogs: showingDialogs(),
  };
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

/** “link”, “button”… in a query say what kind of thing, not which one. */
const ROLE_WORDS = /^(link|links|button|buttons|btn|field|box|input|icon|tab|menu|item|checkbox|option|textbox|dropdown|name)$/;

/** Ranks elements against a free-text description (“search box”, “Add medication”). */
export function find(query: string, limit: number): FindResult {
  const q = norm(query);
  const words = q.split(' ').filter((w) => w.length > 1);
  const { elements } = collectInteractive();
  const scored = elements
    .map((el) => {
      const info = describeElement(el);
      const hay = norm([info.name, info.role, info.placeholder, info.type, info.value, el.getAttribute('name'), el.id].filter(Boolean).join(' '));
      const context = norm(info.context ?? '');
      const name = norm(info.name);
      let score = 0;
      if (name === q) score += 10;
      else if (name.includes(q)) score += 6;
      for (const w of words) {
        if (ROLE_WORDS.test(w)) score += hay.includes(w) ? 0.5 : 0;
        else if (hay.includes(w)) score += 2;
        else if (context.includes(w)) score += 0.25;
      }
      // Synonyms that come up constantly.
      if (/\bsearch\b/.test(q) && (info.role === 'searchbox' || info.type === 'search' || /search/.test(hay))) score += 4;
      if (info.inViewport) score += 0.5;
      if (info.disabled) score -= 1;
      return { info, score };
    })
    .filter((s) => s.score > 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.info);

  const textMatches: string[] = [];
  if (q.length > 2) {
    const body = document.body?.innerText ?? '';
    const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (norm(line).includes(q)) {
        textMatches.push(clip(line, 160));
        if (textMatches.length >= 5) break;
      }
    }
  }
  return { matches: scored, textMatches };
}

const PAYMENT_HINT = /card|cc-|cvc|cvv|iban|expir|billing/i;

/** Facts about an element that decide whether acting on it needs the user's approval. */
/** The filled-in fields of the form or dialog around a control, as label → value. */
function filledValues(scope: Element | null): { label: string; value: string }[] {
  if (!scope) return [];
  const out: { label: string; value: string }[] = [];
  const seen = new Set<string>();
  for (const field of Array.from(scope.querySelectorAll('input,textarea,select,[role=combobox],[contenteditable=true]'))) {
    if (isInput(field) && ['hidden', 'submit', 'button', 'reset', 'image', 'file'].includes(field.type)) continue;
    if (isInput(field) && (field.type === 'checkbox' || field.type === 'radio') && !field.checked) continue;
    if (!isVisibleField(field)) continue;
    const isRadio = isInput(field) && field.type === 'radio';
    const label = isRadio ? groupLabel(field) || accessibleName(field) : accessibleName(field);
    let value = '';
    if (isInput(field) && field.type === 'password') value = field.value ? '••••' : '';
    else if (isRadio) value = accessibleName(field);
    else if (isInput(field) && field.type === 'checkbox') value = 'Yes';
    else if (isSelect(field)) value = field.selectedOptions[0]?.text.trim() ?? '';
    else if (isInput(field) || isTextArea(field)) value = field.value.trim();
    else value = ((field as HTMLElement).innerText ?? '').trim();
    // Custom dropdowns show their choice beside an empty search input: read the box around it,
    // stopping at the form row (its label) and ignoring the placeholder.
    if (!value && field.getAttribute('role') === 'combobox') {
      let node = field.parentElement;
      for (let i = 0; node && i < 4 && !value; i++, node = node.parentElement) {
        if (node.querySelector('label')) break;
        const text = (node.innerText ?? '').trim();
        const placeholder = node.querySelector('[class*="placeholder"]')?.textContent?.trim();
        if (text && text !== placeholder) value = text;
      }
    }
    value = value.replace(/\s+/g, ' ');
    if (!label || !value || seen.has(label) || value === label) continue;
    seen.add(label);
    out.push({ label: label.slice(0, 40), value: value.length > 70 ? `${value.slice(0, 69)}…` : value });
    if (out.length >= 14) break;
  }
  return out;
}

/** A radio button's question (“As Needed (PRN)”), not its own option label (“No”). */
function groupLabel(radio: Element): string {
  const group = radio.closest('[role=radiogroup], fieldset');
  if (group) {
    const name = group.tagName === 'FIELDSET' ? (group.querySelector('legend')?.textContent ?? '') : accessibleName(group);
    if (name.trim()) return name.trim();
  }
  let node = radio.parentElement;
  for (let i = 0; node && i < 6; i++, node = node.parentElement) {
    const label = Array.from(node.querySelectorAll('label')).find((l) => !l.contains(radio) && !l.querySelector('input'));
    if (label?.textContent?.trim()) return label.textContent.trim();
  }
  return '';
}

const isVisibleField = (el: Element) => el.getClientRects().length > 0 || (isInput(el) && (el.type === 'checkbox' || el.type === 'radio'));

export function describeRisk(el: Element): ElementRisk {
  const info = describeElement(el);
  const form = (el as HTMLInputElement).form ?? el.closest('form');
  const fields = form ? Array.from(form.querySelectorAll('input,select,textarea')) : [];
  const submitLabels = form
    ? Array.from(form.querySelectorAll('button,input[type=submit],[role=button]'))
        .map((b) => accessibleName(b))
        .filter(Boolean)
        .slice(0, 6)
    : [];
  return {
    name: info.name,
    role: info.role,
    tag: info.tag,
    type: info.type,
    href: isAnchor(el) ? el.href : undefined,
    target: isAnchor(el) ? el.target : undefined,
    formHasPassword: fields.some((f) => (f as HTMLInputElement).type === 'password'),
    formHasPayment: fields.some((f) => PAYMENT_HINT.test(`${f.getAttribute('autocomplete') ?? ''} ${f.getAttribute('name') ?? ''} ${f.id}`)),
    formIsSearch:
      !!form &&
      (form.getAttribute('role') === 'search' ||
        !!form.closest('[role=search]') ||
        /search/i.test(form.getAttribute('action') ?? '') ||
        fields.some((f) => (f as HTMLInputElement).type === 'search' || /^(q|query|search|s|k|keywords?|term)$/i.test(f.getAttribute('name') ?? ''))),
    formSubmitLabels: submitLabels,
    formValues: filledValues(form ?? el.closest('dialog,[role=dialog],[aria-modal=true]')),
  };
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'svg']);
const CLICK_TARGET = 'a,button,[role=button],[role=link],[role=option],[role=menuitem],[role=tab],[onclick],label';
/** Whole words: “Arya STARK” matches “Arya STARK” but not “Arya STARKK”. */
const hasWords = (hay: string, q: string) => ` ${norm(hay)} `.includes(` ${q} `);

/**
 * Visible elements showing this text — for things a page doesn't mark up as controls,
 * like a patient's name in a table cell whose click is handled by script. Exact matches
 * first, then what is actually on top (not covered), in page order. `near` keeps only
 * matches whose row or item also shows that text (a date of birth, a chart number).
 */
export function findText(text: string, near: string | undefined, limit: number): TextResult {
  const q = norm(text);
  const nearQ = near ? norm(near) : '';
  if (!q) return { matches: [], total: 0 };
  const hits: Element[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  const skip = () => {
    let next = walker.nextSibling();
    while (!next && walker.parentNode()) next = walker.nextSibling();
    return next as Element | null;
  };
  let node = walker.firstChild() as Element | null;
  for (let visited = 0; node && visited < 40000; visited++) {
    // textContent runs table cells together (“STARK03-12-2015”), so this pass is loose;
    // whole words are checked on the rendered text below.
    if (node.id === OVERLAY_HOST_ID || SKIP_TAGS.has(node.tagName) || !norm(node.textContent ?? '').includes(q)) {
      node = skip();
      continue;
    }
    // The deepest element holding the whole text.
    if (!Array.from(node.children).some((c) => norm(c.textContent ?? '').includes(q))) hits.push(node);
    node = walker.nextNode() as Element | null;
  }

  const seen = new Set<Element>();
  // `near`: the match's row or item (or a few levels up) must also show that text.
  const isNear = (el: Element) => {
    if (!nearQ) return true;
    let scope: Element | null = el.closest('tr,[role=row],li,[role=option],[role=listitem],dialog,[role=dialog]');
    if (!scope) {
      scope = el;
      for (let i = 0; i < 4 && scope.parentElement; i++) scope = scope.parentElement;
    }
    return hasWords((scope as HTMLElement).innerText ?? '', nearQ);
  };
  const found = hits
    .filter((el) => isVisible(el) && hasWords((el as HTMLElement).innerText ?? '', q))
    .map((el) => {
      const target = el.closest(CLICK_TARGET);
      return target && target.contains(el) && isVisible(target) ? target : el;
    })
    .filter((el) => !seen.has(el) && seen.add(el))
    .filter(isNear)
    .map((el, order) => {
      const exact = norm((el as HTMLElement).innerText ?? '') === q;
      const r = el.getBoundingClientRect();
      const top = inViewport(el) ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
      const covered = !!top && top !== el && !el.contains(top) && !top.contains(el);
      return { el, exact, covered, order };
    });
  // No such text: a control with that name instead — <input type=button value="Save">, an icon
  // button with a title, or a button inside a same-origin frame (a modal in an iframe).
  if (!found.length) {
    collectInteractive()
      .elements.filter((el) => hasWords(accessibleName(el), q))
      .filter(isNear)
      .forEach((el, order) => found.push({ el, exact: norm(accessibleName(el)) === q, covered: false, order }));
  }
  const best = found.some((f) => f.exact) ? found.filter((f) => f.exact) : found;
  best.sort((a, b) => Number(a.covered) - Number(b.covered) || a.order - b.order);
  // Something on top (a search dropdown) hides what is behind it: prefer what can be clicked.
  const onTop = best.filter((f) => !f.covered);
  const chosen = onTop.length ? onTop : best;
  return { matches: chosen.slice(0, limit).map((f) => describeElement(f.el)), total: chosen.length };
}
