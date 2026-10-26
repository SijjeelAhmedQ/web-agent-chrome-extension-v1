import type { DialogInfo, ElementInfo, ElementRisk, PageSnapshot, ReadMode } from '@/shared/types/page';
import type { FindResult, TextResult } from '../messaging/protocol';
import {
  visualLabel,
  DOC_ID,
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
import { visualRows } from './rows';
import { formFields, formValues, pickerOf, pickerState } from './form';
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
  // A pop-up's corner × that its title calls “Close”: named “×”, or it reads as the pop-up's own Close
  // button (Indici's Special Authority form: its Close button opens the medicine form, its × does not).
  if (/^close$/i.test(info.name) && cornerX(el)) info.name = '×';
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
  // A field named by its placeholder (“Surname First Name”) also gets the label the page shows (“Patient Name”).
  if ((isInput(el) && !['button', 'submit', 'reset', 'image', 'checkbox', 'radio', 'hidden'].includes(el.type)) || isTextArea(el) || isSelect(el)) {
    const picker = isInput(el) ? pickerState(el) : null;
    if (picker) {
      const box = pickerOf(el)!;
      const caption = visualLabel(box) || accessibleName(box);
      if (caption) info.name = caption;
      info.value = picker.chosen.join('; ');
      info.placeholder = picker.several ? 'picker: type a name and choose it; × removes one' : 'dropdown: type to narrow, then choose';
    }
    const seen = picker ? '' : visualLabel(el);
    // A field “named” by its mask (“__/__/____”) is called what the page calls it (“Due”).
    if (seen && !/\p{L}/u.test(info.name)) {
      if (info.name && !info.placeholder) info.placeholder = info.name;
      info.name = seen;
    } else if (seen && seen.toLowerCase() !== info.name.toLowerCase().replace(/[:*]\s*$/, '')) info.label = seen;
  }
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
  // With pop-ups showing, the text that matters is the one in front.
  const shown = Array.from(document.querySelectorAll<HTMLElement>(DIALOGS)).filter((d) => d.getClientRects().length > 0 && !d.parentElement?.closest(DIALOGS));
  const dialog = shown.find((d) => inFront(d)) ?? shown[0];
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

/** A corner × (only “×” or an icon on it, in a pop-up's header or with a close class) — not a button that says “Close”. */
function cornerX(el: Element): boolean {
  const text = ((el as HTMLElement).innerText ?? el.textContent ?? '').trim();
  const cls = typeof el.className === 'string' ? el.className : '';
  return /^(×|✕|✖|╳|x)?$/i.test(text) && (CLOSE_CLASS.test(cls) || !!el.closest('.modal-header,.ui-dialog-titlebar'));
}

/** The × / Close / Cancel control of a dialog, if it has one. */
function closeControl(dialog: Element): Element | null {
  const candidates = dialog.querySelectorAll(
    'button,a,[role=button],input[type=button],input[type=submit],input[type=reset],.close,.btn-close,.ui-dialog-titlebar-close,[data-dismiss],[data-bs-dismiss],[aria-label],[title]',
  );
  for (const el of Array.from(candidates)) {
    // A control of a pop-up inside this one closes that pop-up, not this one.
    if (!isVisible(el) || el.closest(DIALOGS) !== dialog) continue;
    const name = accessibleName(el).trim();
    const cls = typeof el.className === 'string' ? el.className : '';
    if (CLOSE_NAME.test(name) || CLOSE_CLASS.test(cls) || el.hasAttribute('data-dismiss') || el.hasAttribute('data-bs-dismiss')) return el;
  }
  return null;
}

function dialogTitle(dialog: Element): string {
  const labelled = dialog.getAttribute('aria-labelledby');
  const byId = labelled ? labelled.split(/\s+/).map((id) => dialog.ownerDocument.getElementById(id)?.textContent ?? '').join(' ') : '';
  // Its own heading — not one of a pop-up opened inside it.
  const heading = Array.from(dialog.querySelectorAll('.modal-title,.ui-dialog-title,[class*="title"],h1,h2,h3,h4,legend,b,strong')).find((h) => h.closest(DIALOGS) === dialog)?.textContent ?? '';
  // Its first line of text — not its corner × (“× Please add name of specialist…”).
  const first = ((dialog as HTMLElement).innerText ?? '').split('\n').find((l) => l.trim() && !/^[×✕✖╳]$/.test(l.trim())) ?? '';
  return clip((byId || dialog.getAttribute('aria-label') || heading || first).replace(/\s+/g, ' ').trim(), 90);
}

/** The pop-up in front (or the only one), if any. */
function frontDialog(): Element | null {
  const shown = Array.from(document.querySelectorAll(DIALOGS)).filter((d) => {
    if (!isVisible(d)) return false;
    const outer = d.parentElement?.closest(DIALOGS);
    return !outer || dialogTitle(outer) !== dialogTitle(d);
  });
  return shown.find((d) => inFront(d)) ?? shown[0] ?? null;
}

/** A button of the pop-up in front, by its name (“Next”, “Cancel”) — not one of the page behind it. */
export function popupControl(name: string): { id: number | null; disabled: boolean } {
  const d = frontDialog();
  if (!d) return { id: null, disabled: false };
  const want = name.trim().toLowerCase();
  const el = Array.from(d.querySelectorAll('button,input[type=button],input[type=submit],a,[role=button]')).find(
    (c) => isVisible(c) && c.closest(DIALOGS) === d && accessibleName(c).trim().toLowerCase() === want,
  );
  return el ? { id: idFor(el), disabled: isDisabled(el) } : { id: null, disabled: false };
}

/** The pop-ups showing now — the one in front first — each with its close control. */
export function showingDialogs(): DialogInfo[] {
  // A pop-up opened inside another one (a site's alerts put in the open pop-up's markup) counts on
  // its own — unless it is the same pop-up's inner box (same title).
  const dialogs = Array.from(document.querySelectorAll(DIALOGS))
    .filter((d) => {
      if (!isVisible(d)) return false;
      const outer = d.parentElement?.closest(DIALOGS);
      return !outer || dialogTitle(outer) !== dialogTitle(d);
    })
    .slice(0, 6)
    .map((d) => {
      const close = closeControl(d);
      const info: DialogInfo = { title: dialogTitle(d), text: clip(((d as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim(), 220), close: close ? describeElement(close) : null };
      if (inFront(d)) info.onTop = true;
      return { info, el: d };
    });
  // Stacked pop-ups: the one in front is the one to deal with first.
  if (dialogs.length > 1) dialogs.sort((a, b) => Number(!!b.info.onTop) - Number(!!a.info.onTop));
  // The pop-up in front gets all of its text: the agent must be able to read what it asks about.
  const front = dialogs[0];
  if (front) Object.assign(front.info, dialogBody(front.el));
  return dialogs.slice(0, 4).map((d) => d.info);
}

/** All the text of a pop-up, the text of same-site frames inside it included; other sites' frames by host. */
function dialogBody(d: Element): Pick<DialogInfo, 'fullText' | 'frames' | 'pdfs' | 'rows' | 'form'> {
  // Values in its fields (a record's Subject, Result Date, Folder…) are not in its text: list them first.
  const fields = Array.from(d.querySelectorAll('input:not([type=button]):not([type=submit]):not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea'))
    .filter((f) => isVisible(f) && f.closest(DIALOGS) === d)
    .map((f) => {
      const value = isSelect(f) ? (f.selectedOptions[0]?.text ?? '').trim() : ((f as HTMLInputElement).value ?? '').trim();
      const name = (visualLabel(f) || accessibleName(f)).replace(/[:*]\s*$/, '').trim();
      return value && !/^--\s*select\s*--$/i.test(value) && name ? `${name}: ${value}` : '';
    })
    .filter(Boolean)
    .slice(0, 20);
  // A dropdown's text is all its options (every provider, every ACC45 code…): its choice is in the
  // fields above, and its options would push the record's own text out of the limit.
  let text = ((d as HTMLElement).innerText ?? '').trim();
  for (const select of Array.from(d.querySelectorAll('select'))) {
    const options = (select as HTMLElement).innerText?.trim();
    if (options) text = text.replace(options, '');
  }
  const parts = [fields.length ? `Fields — ${fields.join('; ')}` : '', text];
  const frames: string[] = [];
  for (const frame of Array.from(d.querySelectorAll('iframe'))) {
    try {
      const text = frame.contentDocument?.body?.innerText?.trim();
      if (text) parts.push(text);
      else if (!frame.contentDocument) frames.push(hostOf(frame.src));
    } catch {
      frames.push(hostOf(frame.src));
    }
  }
  const fullText = clip(parts.filter(Boolean).join('\n').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n'), 5000);
  const pdfs = pdfsIn(d);
  return {
    ...(fullText ? { fullText } : {}),
    ...(frames.filter(Boolean).length ? { frames: frames.filter(Boolean) } : {}),
    ...(pdfs.length ? { pdfs } : {}),
    rows: visualRows(d),
    form: formFields(d),
  };
}

const PDF_URL = /\.pdf(?:[?#]|$)|[?&/](?:pdf|document|file|download|attachment|viewdoc)/i;

/** The PDFs a pop-up shows: <embed>/<object> of a PDF, or a frame whose document is one. */
function pdfsIn(d: Element): string[] {
  const urls = new Set<string>();
  const abs = (u: string | null) => (u ? new URL(u, location.href).href : '');
  for (const el of Array.from(d.querySelectorAll('embed,object,iframe'))) {
    const src = abs(el.getAttribute('src') ?? el.getAttribute('data'));
    if (!src || src.startsWith('about:') || src.startsWith('javascript:')) continue;
    const type = (el.getAttribute('type') ?? '').toLowerCase();
    let pdf = type.includes('pdf') || PDF_URL.test(src) || src.startsWith('blob:');
    if (!pdf && el.tagName === 'IFRAME') {
      try {
        const doc = (el as HTMLIFrameElement).contentDocument;
        pdf = !!doc && (doc.contentType === 'application/pdf' || !!doc.querySelector('embed[type="application/pdf"]'));
      } catch {
        // Another site's frame: tried as a PDF only if its address looks like one (above).
      }
    }
    if (pdf) urls.add(src);
  }
  return [...urls].slice(0, 3);
}

/** A PDF's bytes, fetched as the page would (its cookies), as base64 — null when it isn't a PDF. */
export async function fetchPdf(url: string): Promise<{ data: string | null; bytes: number; error?: string }> {
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return { data: null, bytes: 0, error: `${res.status} ${res.statusText}` };
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > 25 * 1024 * 1024) return { data: null, bytes: buf.length, error: 'larger than 25 MB' };
    // %PDF at the start: what the file is, whatever the server calls it.
    if (!(buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46)) return { data: null, bytes: buf.length, error: 'not a PDF' };
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { data: btoa(bin), bytes: buf.length };
  } catch (err) {
    return { data: null, bytes: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

function hostOf(src: string): string {
  try {
    return new URL(src, location.href).host;
  } catch {
    return '';
  }
}

/** Whether a pop-up is in front: what's at the middle of its title area belongs to it. */
function inFront(d: Element): boolean {
  const box = (d.querySelector('.modal-content,.modal-dialog,.ui-dialog-content') ?? d).getBoundingClientRect();
  if (!box.width || !box.height) return false;
  const x = Math.min(window.innerWidth - 1, Math.max(0, box.left + box.width / 2));
  const y = Math.min(window.innerHeight - 1, Math.max(0, box.top + Math.min(24, box.height / 2)));
  const hit = document.elementFromPoint(x, y);
  // The point must be the pop-up's own — not a pop-up opened inside it.
  return !!hit && (d === hit || d.contains(hit)) && hit.closest(DIALOGS) === d;
}

/** Reads of this document so far, the read each control first showed up in, and those the last read listed. */
let reads = 0;
const firstSeen = new Map<number, number>();
let listedBefore = new Set<number>();

export function snapshot(mode: ReadMode, maxElements: number, maxTextChars: number): PageSnapshot {
  const { elements, frames } = collectInteractive();
  const described = elements.map(describeElement);
  // On a page of more controls than are listed: first what appeared since the last read and what was
  // listed before (the model knows those) — the newest first, so a tab or panel just opened isn't cut —
  // then what is on screen, then the rest in document order.
  reads++;
  for (const e of described) if (!firstSeen.has(e.id)) firstSeen.set(e.id, reads);
  const known = (e: ElementInfo) => listedBefore.has(e.id) || firstSeen.get(e.id) === reads;
  // The pop-up in front is where the user works: all its controls are listed, before the page behind it.
  const front = frontDialog();
  const inFront = new Set(front ? described.filter((_, i) => front.contains(elements[i])).map((e) => e.id) : []);
  const order = new Map(described.map((e, i) => [e.id, i]));
  const chosen = [...described]
    .sort((a, b) => +inFront.has(b.id) - +inFront.has(a.id) || +known(b) - +known(a) || (firstSeen.get(b.id) ?? 0) - (firstSeen.get(a.id) ?? 0) || +b.inViewport - +a.inViewport || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    .slice(0, maxElements);
  chosen.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const listed = new Set(chosen.map((e) => e.id));
  listedBefore = listed;

  const textBudget = mode === 'content' ? maxTextChars : Math.min(2500, maxTextChars);
  const { text, truncated } = pageText(textBudget);
  return {
    url: location.href,
    title: document.title,
    scroll: scrollState(),
    elements: chosen,
    omitted: described.length - chosen.length,
    unlisted: described.filter((e) => !listed.has(e.id)).map((e) => e.id),
    headings: headings(),
    text,
    textTruncated: truncated,
    frames,
    dialogOpen: Array.from(document.querySelectorAll('dialog[open],[role=dialog]:not([aria-hidden=true]),[aria-modal=true]')).some((d) => isVisible(d)),
    dialogs: showingDialogs(),
    docId: DOC_ID,
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
  const front = frontDialog();
  const scored = elements
    .map((el) => {
      const info = describeElement(el);
      const hay = norm([info.name, info.label, info.role, info.placeholder, info.type, info.value, el.getAttribute('name'), el.id].filter(Boolean).join(' '));
      const context = norm(info.context ?? '');
      const name = norm(info.name);
      const label = norm(info.label ?? '');
      let score = 0;
      if (name === q || (label && label === q)) score += 10;
      else if (name.includes(q) || (label && label.includes(q))) score += 6;
      for (const w of words) {
        if (ROLE_WORDS.test(w)) score += hay.includes(w) ? 0.5 : 0;
        else if (hay.includes(w)) score += 2;
        // “Inactive icon in the HBA1C recall row”: the row's words count — they say which one.
        else if (context.includes(w)) score += 1;
      }
      // The control's whole name is one of the words asked for (“Inactive”, “Edit”): that is the one meant,
      // not a longer text that merely shares more of the other words.
      if (name && !name.includes(' ') && words.includes(name)) score += 4;
      // Synonyms that come up constantly.
      if (/\bsearch\b/.test(q) && (info.role === 'searchbox' || info.type === 'search' || /search/.test(hay))) score += 4;
      if (info.inViewport) score += 0.5;
      // The pop-up in front is where the user is working.
      if (score > 1 && front?.contains(el)) score += 3;
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
    // The label the form shows (“Subject / Progress”, “Due”) — not a placeholder or a “__/__/____” mask.
    const shownLabel = isRadio ? '' : visualLabel(field).replace(/[:*]\s*$/, '');
    const label = isRadio ? groupLabel(field) || accessibleName(field) : shownLabel || accessibleName(field);
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

const ACTION_BUTTONS = 'button,input[type=button],input[type=submit],input[type=reset],a.btn,[role=button]';

/**
 * A button that ends a form in a pop-up and the ones beside it (a footer: Complete · Save · Reset ·
 * Cancel): the smallest box around the button holding three or more such buttons, in a pop-up.
 */
function formActions(el: Element): { id: number; name: string }[] {
  const dialog = el.closest(DIALOGS);
  if (!dialog) return [];
  // Enter in a field (not a button): the form's own footer — the box around its last button with three or more.
  if (!el.matches(ACTION_BUTTONS)) {
    const all = Array.from(dialog.querySelectorAll(ACTION_BUTTONS)).filter((b) => isVisible(b) && !isDisabled(b) && /\p{L}/u.test(accessibleName(b)) && accessibleName(b).length <= 24);
    const last = all.at(-1);
    return last ? formActions(last) : [];
  }
  // Only the buttons on its own line: a pop-up's header buttons (“Back to List”, “Clinical Summary”) don't finish the form.
  const at = el.getBoundingClientRect();
  const sameLine = (b: Element) => {
    const r = b.getBoundingClientRect();
    return !at.height || (r.bottom > at.top + 2 && r.top < at.bottom - 2);
  };
  let box = el.parentElement;
  for (let depth = 0; box && depth < 5; depth++, box = box.parentElement) {
    const buttons = Array.from(box.querySelectorAll(ACTION_BUTTONS)).filter((b) => isVisible(b) && !isDisabled(b) && sameLine(b));
    const named = buttons.map((b) => ({ el: b, name: accessibleName(b).trim() })).filter((b) => /\p{L}/u.test(b.name) && b.name.length <= 24);
    if (named.length >= 3 && named.some((b) => b.el === el)) return named.slice(0, 6).map((b) => ({ id: idFor(b.el), name: b.name }));
    if (box.matches(DIALOGS)) break;
  }
  return [];
}

/**
 * A small form in the page itself, not a pop-up (the Smart Inbox's quick-edit card): the nearest box around
 * the button that holds a few fields — not the whole page.
 */
function cardAround(el: Element): Element | null {
  let box = el.parentElement;
  for (let depth = 0; box && depth < 6; depth++, box = box.parentElement) {
    const fields = Array.from(box.querySelectorAll('input:not([type=hidden]),textarea,select,[contenteditable=true]')).filter((f) => isVisible(f));
    if (fields.length > 12) return null;
    if (fields.length) return box;
  }
  return null;
}

export function describeRisk(el: Element): ElementRisk {
  const info = describeElement(el);
  const form = (el as HTMLInputElement).form ?? el.closest('form');
  const fields = form ? Array.from(form.querySelectorAll('input,select,textarea')) : [];
  // No <form> (a pop-up built with divs): its footer buttons (Save, Complete…) are what Enter would do.
  const actions = formActions(el);
  const submitLabels = form
    ? Array.from(form.querySelectorAll('button,input[type=submit],[role=button]'))
        .map((b) => accessibleName(b))
        .filter(Boolean)
        .slice(0, 6)
    : actions.map((b) => b.name);
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
    // A pop-up form: its fields as the live form reading names them (pickers, radios, ticks); else the form's filled fields.
    formValues: (() => {
      const dialog = el.closest(DIALOGS);
      const live = dialog ? formValues(dialog) : form ? [] : formValues(cardAround(el) ?? el);
      return live.length ? live : filledValues(form ?? el.closest('dialog,[role=dialog],[aria-modal=true]'));
    })(),
    formActions: actions,
    shown: el.isConnected && isVisible(el),
    dialogText: clip(((el.closest(DIALOGS) as HTMLElement | null)?.innerText ?? '').replace(/\s+/g, ' ').trim(), 300) || undefined,
    context: info.context,
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
/** “×”, “✕”, “+”: a control shown as a sign. A close sign means the pop-up in front's own close button. */
function symbolText(sign: string): TextResult {
  if (!sign || sign.length > 3) return { matches: [], total: 0 };
  const front = frontDialog();
  if (/^[×✕✖xX]$/.test(sign) && front) {
    const close = closeControl(front);
    if (close) return { matches: [describeElement(close)], total: 1 };
  }
  const shown = (el: Element) => ((el as HTMLElement).innerText || (el as HTMLInputElement).value || '').trim();
  const hits = collectInteractive().elements.filter((el) => shown(el) === sign);
  const pool = front && hits.some((el) => front.contains(el)) ? hits.filter((el) => front.contains(el)) : hits;
  return { matches: pool.slice(0, 6).map(describeElement), total: pool.length };
}

export function findText(text: string, near: string | undefined, limit: number): TextResult {
  const q = norm(text);
  const nearQ = near ? norm(near) : '';
  if (!q) return symbolText(text.trim());
  const hits: Element[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  const skip = () => {
    let next = walker.nextSibling();
    while (!next && walker.parentNode()) next = walker.nextSibling();
    return next as Element | null;
  };
  let node = walker.firstChild() as Element | null;
  for (let visited = 0; node && visited < 150_000; visited++) {
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
  // A pop-up in front: what it holds is what the user means — not the page's control of the same name behind it.
  const front = frontDialog();
  const inPopup = front ? found.filter((f) => front.contains(f.el)) : [];
  const pool = inPopup.length ? inPopup : found;
  const best = pool.some((f) => f.exact) ? pool.filter((f) => f.exact) : pool;
  best.sort((a, b) => Number(a.covered) - Number(b.covered) || a.order - b.order);
  // Something on top (a search dropdown) hides what is behind it: prefer what can be clicked.
  const onTop = best.filter((f) => !f.covered);
  const chosen = onTop.length ? onTop : best;
  return { matches: chosen.slice(0, limit).map((f) => describeElement(f.el)), total: chosen.length };
}
