import type { DialogInfo } from '@/shared/types/page';
import type {
  ClickEffect,
  ClickResult,
  ContentError,
  KeyResult,
  ScrollDirection,
  ScrollResult,
  SelectResult,
  TypeResult,
} from '../messaging/protocol';
import { accessibleName, elementFor, hasHiddenMenu, isDisabled, isEditable, isVisible, OVERLAY_HOST_ID, roleOf, visualLabelInfo } from './elements';
import { isHovered, openHoverMenu, releaseHoverUnlessInside } from './hover';
import { closeList, listOf as ownLists } from './choices';
import { highlight } from './overlay';
import { showingDialogs } from './snapshot';
import { isButton, isHTML, isInput, isLabel, isSelect, isTextArea } from './dom';

/**
 * Generic page actions. Events are dispatched the way frameworks (React, Vue, Angular,
 * Ant Design…) expect: pointer + mouse sequences for clicks, the native value setter plus
 * input/change for typing, execCommand for rich-text editors.
 */

export class ActionError extends Error {
  constructor(public readonly error: ContentError) {
    super(error.message);
  }
}

const fail = (code: ContentError['code'], message: string, detail?: string): never => {
  throw new ActionError({ code, message, detail });
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function resolve(id: number): Element {
  const el = elementFor(id);
  if (!el) {
    return fail('stale_element', `Element [${id}] is no longer on the page.`, 'Call read_page to get fresh element ids.');
  }
  return el;
}

const summary = (el: Element) => ({ name: accessibleName(el), role: roleOf(el) });

/**
 * The control scrolled into sight before anything is done to it, so the user sees what is typed or clicked: inside
 * every box that scrolls around it (a drawer's body, a table), not only the window — and when something lies over it
 * (a sticky header or footer, a white panel), its box is scrolled on until the control is clear of it.
 */
function reveal(el: Element) {
  const clipped = () => {
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) return true;
    for (let a = el.parentElement; a; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (!/(auto|scroll|hidden)/.test(`${s.overflowY}${s.overflowX}`)) continue;
      const b = a.getBoundingClientRect();
      if (r.top < b.top - 1 || r.bottom > b.bottom + 1) return true;
    }
    return false;
  };
  if (clipped()) el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' as ScrollBehavior });
  // Something on top of it: the box that scrolls is moved so the control comes out from under it.
  for (let i = 0; i < 3; i++) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
    const y = Math.min(Math.max(r.top + Math.min(r.height / 2, 12), 1), innerHeight - 1);
    const hit = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null;
    if (!hit || hit === el || el.contains(hit) || hit.contains(el) || hit.closest('label')?.contains(el) || (hit.closest('label') && (el as HTMLInputElement).labels && Array.from((el as HTMLInputElement).labels ?? []).includes(hit.closest('label') as HTMLLabelElement))) return;
    let box: Element | null = el.parentElement;
    while (box && !(box.scrollHeight > box.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
    const cover = hit.getBoundingClientRect();
    const scroller = box ?? document.scrollingElement;
    if (!scroller) return;
    // Covered from above (a sticky header): scroll back so it sits lower; from below (a sticky footer): further on.
    const fromAbove = cover.top <= r.top;
    scroller.scrollTop += fromAbove ? -(cover.bottom - r.top + 16) : r.bottom - cover.top + 16;
  }
}

async function prepare(el: Element, label: string, show: boolean) {
  reveal(el);
  if (show) {
    highlight(el, label);
    await sleep(220);
  }
}

function centerOf(el: Element) {
  const r = el.getBoundingClientRect();
  return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
}

function dispatchPointerSequence(el: Element, detail = 1) {
  const view = el.ownerDocument.defaultView ?? window;
  const point = centerOf(el);
  const base = { bubbles: true, cancelable: true, composed: true, view, button: 0, detail, ...point };
  el.dispatchEvent(new PointerEvent('pointerover', { ...base, pointerType: 'mouse', isPrimary: true }));
  el.dispatchEvent(new MouseEvent('mouseover', base));
  el.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerType: 'mouse', isPrimary: true, buttons: 1 }));
  el.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
  if (isHTML(el)) el.focus({ preventScroll: true });
  el.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerType: 'mouse', isPrimary: true }));
  el.dispatchEvent(new MouseEvent('mouseup', base));
}

/** Fields that block a form's submission under the browser's built-in validation. */
function invalidFieldsOf(form: HTMLFormElement | null): string[] | undefined {
  if (!form || form.noValidate || form.checkValidity()) return undefined;
  const problems = Array.from(form.elements)
    .filter((f): f is HTMLInputElement => 'validity' in f && !(f as HTMLInputElement).validity.valid)
    .slice(0, 8)
    .map((f) => `“${accessibleName(f) || f.getAttribute('name') || 'field'}”: ${f.validationMessage}`);
  return problems.length ? problems : undefined;
}

const isSubmitControl = (el: Element) =>
  (isButton(el) && el.type === 'submit') || (isInput(el) && (el.type === 'submit' || el.type === 'image'));

/** Watches the page from just before a click, until the next click: settle (and later checks) report what changed. */
let watch: { lines: Set<string>; frames: Set<Element>; styleChanges: number; observer: MutationObserver } | null = null;

/** Rendered text lines of the page and of same-origin frames (modals often load a page in an iframe). */
function visibleLines(): Set<string> {
  const lines = new Set<string>();
  const add = (text: string | undefined) => {
    for (const l of (text ?? '').split('\n')) {
      const t = l.replace(/\s+/g, ' ').trim();
      if (t.length > 1) lines.add(t);
    }
  };
  add(document.body?.innerText);
  for (const frame of visibleFrames()) {
    try {
      add((frame as HTMLIFrameElement).contentDocument?.body?.innerText);
    } catch {
      // cross-origin: its text can't be read
    }
  }
  return lines;
}

const visibleFrames = () => Array.from(document.querySelectorAll('iframe,frame')).filter((f) => isVisible(f));

function watchEffects() {
  watch?.observer.disconnect();
  const w = { lines: visibleLines(), frames: new Set(visibleFrames()), styleChanges: 0, observer: new MutationObserver(() => undefined) };
  w.observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type !== 'attributes') continue;
      const target = r.target as Element;
      if (target.id === OVERLAY_HOST_ID || target === document.documentElement) continue;
      // Our own hover emulation class doesn't count.
      if (r.attributeName === 'class' && (r.oldValue ?? '').replace(/\s*__wa-hover\b/g, '').trim() === target.getAttribute('class')?.replace(/\s*__wa-hover\b/g, '').trim()) continue;
      w.styleChanges++;
    }
  });
  w.observer.observe(document.documentElement, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'style', 'aria-selected', 'aria-checked', 'aria-expanded', 'checked', 'open', 'hidden'] });
  watch = w;
}

/** What changed since the last click started. */
export function currentEffect(): ClickEffect | undefined {
  if (!watch) return undefined;
  const now = visibleLines();
  const added = [...now].filter((l) => !watch!.lines.has(l));
  let removed = 0;
  for (const l of watch.lines) if (!now.has(l)) removed++;
  const newFrames = visibleFrames()
    .filter((f) => !watch!.frames.has(f))
    .map((f) => {
      let title = '';
      try {
        title = (f as HTMLIFrameElement).contentDocument?.title ?? '';
      } catch {
        title = '';
      }
      return `(a frame opened${title ? `: ${title}` : ''})`;
    });
  return {
    added: [...newFrames, ...added].slice(0, 6).map((l) => (l.length > 120 ? `${l.slice(0, 119)}…` : l)),
    removed,
    styleChanges: watch.styleChanges,
  };
}

/**
 * Where a real mouse click would land on this element (viewport coordinates), with the
 * element scrolled into view. Starts watching the page so the next settle reports the effect.
 */
export function pointAt(id: number): { x: number; y: number } {
  const el = resolve(id);
  reveal(el);
  const r = el.getBoundingClientRect();
  // The centre, unless something covers it there: then the first spot where it is on top.
  const spots = [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75], [0.15, 0.5], [0.85, 0.5]];
  let point = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  for (const [fx, fy] of spots) {
    const x = r.left + r.width * fx;
    const y = r.top + r.height * fy;
    const top = document.elementFromPoint(x, y);
    if (top && (top === el || el.contains(top))) {
      point = { x, y };
      break;
    }
  }
  watchEffects();
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

export async function click(id: number, show: boolean, double = false): Promise<ClickResult> {
  const el = resolve(id);
  if (!isVisible(el) && !(isInput(el))) fail('not_visible', 'That element is hidden right now.', 'It may be inside a closed menu or collapsed section. Open the menu first or scroll.');
  if (isDisabled(el)) fail('disabled', `“${accessibleName(el) || 'That control'}” is disabled.`, 'A required field may be empty, or a previous step is incomplete.');
  await prepare(el, 'Clicking', show);

  // Links that open a new tab: script-initiated pop-ups are blocked, so the agent opens it.
  const anchor = el.closest('a[href]') as HTMLAnchorElement | null;
  if (anchor && anchor.target === '_blank' && /^https?:/.test(anchor.href)) {
    return { element: summary(el), opensNewTab: anchor.href };
  }

  const { clientX, clientY } = centerOf(el);
  const top = el.ownerDocument.elementFromPoint(clientX, clientY);
  const covered = !!top && top !== el && !el.contains(top) && !top.contains(el);

  // A menu trigger (“Patients” in a hover navbar): open its menu instead of clicking.
  // Clicking it again, with the menu open, really clicks — for when the page itself is wanted.
  if (hasHiddenMenu(el) && !isHovered(el)) {
    const menu = await openHoverMenu(el);
    if (menu.length) return { element: summary(el), menu };
  }

  const submitter = el.closest('button,input');
  const invalidFields = submitter && isSubmitControl(submitter) ? invalidFieldsOf((submitter as HTMLButtonElement).form) : undefined;

  releaseHoverUnlessInside(el);
  watchEffects();
  dispatchPointerSequence(el);
  if (isHTML(el)) el.click();
  else el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, ...centerOf(el) }));
  if (double) {
    // Lists that open a record on double-click: second press, then dblclick.
    dispatchPointerSequence(el, 2);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view: window, detail: 2, ...centerOf(el) }));
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, composed: true, view: window, detail: 2, ...centerOf(el) }));
  }
  return { element: summary(el), covered: covered || undefined, invalidFields };
}

const nativeSetter = (el: HTMLInputElement | HTMLTextAreaElement) => {
  const win = (el.ownerDocument.defaultView ?? window) as typeof window;
  const proto = isTextArea(el) ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
  return Object.getOwnPropertyDescriptor(proto, 'value')?.set;
};

/** Finds the actual text field for a container (custom comboboxes wrap an <input>). */
function editableTarget(el: Element): HTMLInputElement | HTMLTextAreaElement | HTMLElement {
  if (isEditable(el)) return el;
  const inner = el.querySelector('input:not([type=hidden]),textarea,[contenteditable=""],[contenteditable=true]');
  if (inner && isEditable(inner)) return inner;
  const forLabel = isLabel(el) ? el.control : null;
  if (forLabel && isEditable(forLabel)) return forLabel;
  return fail('not_editable', `“${accessibleName(el) || 'That element'}” isn't a text field.`, 'Pick a textbox, searchbox or combobox from read_page.');
}

function setFieldValue(field: HTMLInputElement | HTMLTextAreaElement, value: string, data: string | null) {
  const setter = nativeSetter(field);
  if (setter) setter.call(field, value);
  else field.value = value;
  field.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: data ? 'insertText' : 'deleteContentBackward', data }));
}

/** Calendars that open on a date field (bootstrap-datepicker, jQuery UI, flatpickr, Kendo, pikaday…). */
const DATE_PICKERS = '.datepicker-dropdown,.ui-datepicker,.flatpickr-calendar.open,.daterangepicker,.bootstrap-datetimepicker-widget,.k-calendar-container,.pika-single:not(.is-hidden),.react-datepicker-popper,.xdsoft_datetimepicker';

/**
 * A date typed in full needs no calendar: close the one it opened, as a person would — Tab out of
 * the field, then a press outside it. Not Escape: on many sites that closes the whole pop-up.
 */
async function closeDatePicker(field: HTMLElement): Promise<void> {
  const open = () => Array.from(field.ownerDocument.querySelectorAll(DATE_PICKERS)).some((p) => isVisible(p));
  await sleep(120);
  if (!open()) return;
  const key = (type: string) => field.dispatchEvent(new KeyboardEvent(type, { key: 'Tab', code: 'Tab', keyCode: 9, which: 9, bubbles: true, cancelable: true } as KeyboardEventInit));
  key('keydown');
  key('keyup');
  await sleep(150);
  if (!open()) return;
  // A press on the form around the field (not on the calendar) — what “click elsewhere” does.
  const around = field.closest('.modal-body,form,[role=dialog],.modal') ?? field.ownerDocument.body;
  for (const type of ['mousedown', 'mouseup']) around.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: field.ownerDocument.defaultView }));
  field.blur();
  await sleep(150);
}

const ANT_DATE_POPUP = '.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)';

const antPopup = (doc: Document): Element | null => Array.from(doc.querySelectorAll(ANT_DATE_POPUP)).filter((p) => isVisible(p)).at(-1) ?? null;
const pad2 = (x: number) => String(x).padStart(2, '0');
const numbersIn = (s: string) => (s.match(/\d+/g) ?? []).map(Number);

/**
 * The order a field writes its dates in, from the date it shows and the day its calendar marks: “10/11/2025” with
 * 2025-11-10 marked is day first. Null when it can't be told.
 */
export function dateOrder(popup: Element, shown: string): 'dmy' | 'mdy' | 'ymd' | null {
  const n = numbersIn(shown);
  if (n.length !== 3) return null;
  if (n[0] > 31) return 'ymd';
  const marked = new Set(
    Array.from(popup.querySelectorAll('td.ant-picker-cell-selected[title],td.ant-picker-cell-range-start[title],td.ant-picker-cell-range-end[title]')).map((c) => c.getAttribute('title')),
  );
  const dmy = `${n[2]}-${pad2(n[1])}-${pad2(n[0])}`;
  const mdy = `${n[2]}-${pad2(n[0])}-${pad2(n[1])}`;
  if (dmy !== mdy && marked.has(dmy) !== marked.has(mdy)) return marked.has(dmy) ? 'dmy' : 'mdy';
  if (n[0] > 12) return 'dmy';
  if (n[1] > 12) return 'mdy';
  return null;
}

/** A typed date as the calendar's cells name it (YYYY-MM-DD), read in the field's order — day first when it can't be told. */
export function isoOf(typed: string, order: 'dmy' | 'mdy' | 'ymd' | null): string | null {
  const n = numbersIn(typed);
  if (n.length !== 3) return null;
  let [y, m, d] = n[0] > 31 || order === 'ymd' ? [n[0], n[1], n[2]] : order === 'mdy' ? [n[2], n[0], n[1]] : [n[2], n[1], n[0]];
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

const monthNumber = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7));

/**
 * A date chosen in an Ant Design calendar as a person does it: open the calendar, go to the month with its arrows,
 * click the day. Not by typing: the Smart Inbox's Date range read a typed 01/10/2026 month first (10 January)
 * although it shows its dates day first, and a typed date is only a draft until taken. 'disabled' when that day is
 * disabled there; null when there is no calendar to use this way (then the date is typed).
 */
async function pickAntDate(field: HTMLInputElement | HTMLTextAreaElement, typed: string): Promise<'picked' | 'disabled' | null> {
  const doc = field.ownerDocument;
  let cal = antPopup(doc);
  if (!cal) {
    dispatchPointerSequence(field);
    field.click();
    for (let i = 0; i < 10 && !(cal = antPopup(doc)); i++) await sleep(100);
  }
  if (!cal) return null;
  const iso = isoOf(typed, dateOrder(cal, field.value));
  if (!iso) return null;
  const month = monthNumber(iso);
  const arrow = (selector: string) =>
    Array.from(cal!.querySelectorAll<HTMLElement>(selector)).find((b) => isVisible(b) && getComputedStyle(b).visibility !== 'hidden') ?? null;
  let cell: Element | null = null;
  for (let i = 0; i < 40; i++) {
    cell = cal.querySelector(`td.ant-picker-cell-in-view[title="${iso}"]`);
    if (cell) break;
    const shown = Array.from(cal.querySelectorAll('td.ant-picker-cell-in-view[title]')).map((c) => monthNumber(c.getAttribute('title') ?? '')).filter((x) => x > 0);
    if (!shown.length) return null;
    const first = Math.min(...shown);
    const last = Math.max(...shown);
    if (month >= first && month <= last) return null; // its month is showing, the day isn't: not a calendar we know
    const back = month < first;
    const far = (back ? first - month : month - last) >= 12;
    const button = arrow(back ? (far ? '.ant-picker-header-super-prev-btn' : '.ant-picker-header-prev-btn') : far ? '.ant-picker-header-super-next-btn' : '.ant-picker-header-next-btn');
    if (!button) return null;
    button.click();
    await sleep(60);
    cal = antPopup(doc) ?? cal;
  }
  if (!cell) return null;
  if (cell.matches('.ant-picker-cell-disabled')) return 'disabled';
  dispatchPointerSequence(cell);
  (cell as HTMLElement).click();
  await sleep(250);
  return 'picked';
}

/**
 * Out of an Ant date field, then its value can be read: a date not taken stays as typed text while the field has
 * focus and is put back only when it loses it (read before that, it looked typed — “Done” — and the model went round
 * Expand, Clear and Type). A press outside closes the calendar.
 */
async function leaveAntDate(field: HTMLInputElement | HTMLTextAreaElement): Promise<void> {
  const doc = field.ownerDocument;
  for (const type of ['mousedown', 'mouseup']) doc.body.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: doc.defaultView }));
  field.blur();
  const active = doc.activeElement as HTMLElement | null;
  if (active && active !== doc.body && active.closest('.ant-picker')) active.blur(); // a range moved on to its end
  await sleep(300);
  if (antPopup(doc)) await sleep(300);
}

/** No calendar to click in: the date typed, a moment for the page to read it (React), Enter, and out. */
async function confirmAntDate(field: HTMLInputElement | HTMLTextAreaElement): Promise<void> {
  await sleep(250);
  const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true } as KeyboardEventInit;
  field.dispatchEvent(new KeyboardEvent('keydown', init));
  field.dispatchEvent(new KeyboardEvent('keyup', init));
  await sleep(250);
  await leaveAntDate(field);
}

/** The shape of a date as written — “10/11/2026” and “01/01/2027” alike, “2027-01-01” not. */
const dateShape = (s: string) => s.trim().replace(/\d/g, '9');

/** The same date, however written: 1/3/2026 is 01/03/2026 (the same numbers in the same order). */
export function sameDate(shown: string, typed: string): boolean {
  const nums = (s: string) => (s.match(/\d+/g) ?? []).map(Number);
  const a = nums(shown);
  const b = nums(typed);
  return b.length > 0 && a.length === b.length && a.every((n, i) => n === b[i]);
}

/** Lists of suggestions that open under a field as you type (jQuery UI autocomplete, chosen, select2, typeahead…). */
const SUGGESTION_LISTS = '.ui-autocomplete,[role=listbox],.chosen-results,.select2-results,.tt-menu,.typeahead,.autocomplete-suggestions,.easy-autocomplete-container,.dropdown-menu';

/**
 * What a field offered after typing — “3 Month(s)”, “Training DOCTOR (Doctor)”. Typing alone chooses none
 * of them; the model has to click one, so it is told they are there.
 */
async function suggestionsUnder(field: HTMLElement): Promise<string[]> {
  await sleep(700);
  const box = field.getBoundingClientRect();
  const doc = field.ownerDocument;
  for (const list of Array.from(doc.querySelectorAll(SUGGESTION_LISTS))) {
    if (!isVisible(list) || list.contains(field)) continue;
    const r = list.getBoundingClientRect();
    // Opened by this field: just under (or over) it, overlapping it sideways.
    if (r.top > box.bottom + 40 || r.bottom < box.top - 400 || r.right < box.left - 20 || r.left > box.right + 20) continue;
    const items = Array.from(list.querySelectorAll('li,[role=option],.tt-suggestion,a'))
      .filter((i) => isVisible(i) && !i.querySelector('li,[role=option]'))
      .map((i) => ((i as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim())
      .filter((t) => t && t.length <= 80);
    if (items.length) return Array.from(new Set(items)).slice(0, 8);
  }
  return [];
}

export async function type(id: number, text: string, clearFirst: boolean, show: boolean, trusted = false): Promise<TypeResult> {
  const el = resolve(id);
  if (isDisabled(el)) fail('disabled', `“${accessibleName(el) || 'That field'}” is disabled.`);
  const field = editableTarget(el);
  await prepare(field, 'Typing', show);
  field.focus({ preventScroll: true });
  dispatchPointerSequence(field);

  if (isInput(field) || isTextArea(field)) {
    const antDate = !!field.closest('.ant-picker');
    if (antDate) {
      // Which box of a range is being typed in, the page learns from its focus event — which the browser doesn't
      // send while the side panel has the focus. Send it; then a moment for the calendar to open.
      if (!field.ownerDocument.hasFocus()) {
        field.dispatchEvent(new FocusEvent('focus'));
        field.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      }
      await sleep(200);
      // The calendar first, as a person picks a date; typing only when there is none to use.
      const before = field.value;
      const picked = await pickAntDate(field, text);
      if (picked) {
        await leaveAntDate(field);
        const kept = field.value;
        if (picked === 'picked' && sameDate(kept, text)) return { element: summary(el), value: kept };
        return { element: summary(el), value: kept, dateNotTaken: { box: field.placeholder || '', why: picked === 'disabled' ? 'disabled' : 'unknown', before } };
      }
    }
    // An Ant date always holds a date: the new one replaces it in one go (emptied first, the range would change to
    // “no start date” on the way).
    const start = clearFirst || antDate ? '' : field.value;
    if (clearFirst && field.value && !antDate) setFieldValue(field, '', null);
    // Key events per character for autocompletes that listen to keys; value set in one go.
    const last = text.slice(-1);
    field.dispatchEvent(new KeyboardEvent('keydown', { key: last, bubbles: true, composed: true }));
    setFieldValue(field, start + text, text);
    field.dispatchEvent(new KeyboardEvent('keyup', { key: last, bubbles: true, composed: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    if (antDate) {
      const before = field.defaultValue || '';
      await confirmAntDate(field);
      const kept = field.value;
      if (sameDate(kept, text)) return { element: summary(el), value: kept };
      // Typed, with no calendar to see: why it wasn't taken can't be seen — not called disabled (01/10/2026, a date
      // it allows, once was). Written unlike the field's dates: the format, maybe.
      const like = kept || before;
      const why = !like || dateShape(like) === dateShape(text) ? 'unknown' : 'format';
      return { element: summary(el), value: kept, dateNotTaken: { box: field.placeholder || '', why, before } };
    }
    // A date field of the browser's own with limits (min / max): a date outside them is one it doesn't allow.
    if (isInput(field) && /^(date|datetime-local|month|week|time)$/.test(field.type) && (field.validity.rangeUnderflow || field.validity.rangeOverflow)) {
      const allowed = [field.min && `from ${field.min}`, field.max && `up to ${field.max}`].filter(Boolean).join(' ');
      return { element: summary(el), value: field.value, dateNotTaken: { box: field.placeholder || '', why: 'disabled', ...(allowed ? { allowed } : {}) } };
    }
    await closeDatePicker(field);
    const suggestions = await suggestionsUnder(field);
    return { element: summary(el), value: field.type === 'password' ? '••••' : field.value, ...(suggestions.length ? { suggestions } : {}) };
  }

  // contenteditable (rich editors such as Gmail's composer).
  const doc = field.ownerDocument;
  const selection = doc.getSelection();
  if (clearFirst) {
    const range = doc.createRange();
    range.selectNodeContents(field);
    selection?.removeAllRanges();
    selection?.addRange(range);
  } else {
    const range = doc.createRange();
    range.selectNodeContents(field);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  // Editors that keep their own model (CKEditor) take only real keyboard input: the caller sends it now.
  if (trusted) return { element: summary(el), value: (field.innerText ?? '').slice(0, 200), awaitsInput: true };
  // execCommand is deprecated but remains the only way to type into editors the way a user does.
  const inserted = doc.execCommand('insertText', false, text);
  if (!inserted) {
    if (clearFirst) field.textContent = text;
    else field.textContent = (field.textContent ?? '') + text;
    field.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
  }
  return { element: summary(el), value: (field.innerText ?? '').slice(0, 200) };
}

/** What a field holds now (a rich editor's text). */
export function fieldText(id: number): { value: string } {
  const field = editableTarget(resolve(id));
  const value = isInput(field) || isTextArea(field) ? field.value : (field.innerText ?? '');
  // Whole: a long comment's end is where words added before are.
  return { value: value.replace(/\s+/g, ' ').trim().slice(0, 20_000) };
}

export async function clear(id: number, show: boolean): Promise<TypeResult> {
  const el = resolve(id);
  const field = editableTarget(el);
  await prepare(field, 'Clearing', show);
  field.focus({ preventScroll: true });
  if (isInput(field) || isTextArea(field)) {
    setFieldValue(field, '', null);
    field.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    const doc = field.ownerDocument;
    const range = doc.createRange();
    range.selectNodeContents(field);
    doc.getSelection()?.removeAllRanges();
    doc.getSelection()?.addRange(range);
    if (!doc.execCommand('delete')) field.textContent = '';
  }
  return { element: summary(el), value: '' };
}

const optionNorm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
/** Singular and plural alike — “3 Months” is the option “3 Month(s)”. Only for an exact match after the others. */
const optionLoose = (s: string) => optionNorm(s).replace(/\(s\)/g, '').replace(/([a-z])s\b/g, '$1');

export async function select(id: number, option: string, show: boolean): Promise<SelectResult> {
  const el = resolve(id);
  const native = isSelect(el) ? el : el.querySelector('select');
  if (!native) {
    const custom = await chooseInCustom(el, option, show);
    if (custom) return custom;
    const listed = await chooseInListbox(el, option, show);
    if (listed) return listed;
    return fail('not_native_select', `“${accessibleName(el) || 'That control'}” is a custom dropdown.`, 'Click it to open the list, then click the option you want (read_page after opening).');
  }
  if (native.disabled) fail('disabled', `“${accessibleName(native)}” is disabled.`);
  const wanted = optionNorm(option);
  const options = Array.from(native.options);
  const match =
    options.find((o) => optionNorm(o.text) === wanted || optionNorm(o.value) === wanted) ??
    options.find((o) => optionNorm(o.text).startsWith(wanted)) ??
    options.find((o) => optionNorm(o.text).includes(wanted)) ??
    options.find((o) => optionLoose(o.text) === optionLoose(option));
  if (!match) {
    return fail('option_not_found', `There's no option “${option}”.`, `Available: ${options.map((o) => o.text.trim()).filter(Boolean).slice(0, 40).join(' | ')}`);
  }
  await prepare(native, 'Selecting', show);
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  if (setter) setter.call(native, match.value);
  else native.value = match.value;
  match.selected = true;
  native.dispatchEvent(new Event('input', { bubbles: true }));
  native.dispatchEvent(new Event('change', { bubbles: true }));
  return { element: summary(native), selected: match.text.trim() };
}

/**
 * Any dropdown that points at its list (aria-haspopup="listbox", a combobox, aria-controls — Mantine, Headless UI,
 * MUI, Radix…): opened, narrowed by typing the choice when it is a search box, and the option clicked — the agent's
 * one step, not a click, a read, a type and another click. Null when the control is not one.
 */
export async function chooseInListbox(el: Element, option: string, show: boolean): Promise<SelectResult | null> {
  const picks = (e: Element) => e.getAttribute('aria-haspopup') === 'listbox' || e.getAttribute('role') === 'combobox' || !!e.getAttribute('aria-controls');
  const trigger = picks(el) ? el : el.querySelector('[aria-haspopup="listbox"], [role="combobox"]');
  if (!trigger || !isHTML(trigger)) return null;
  if (isDisabled(trigger)) fail('disabled', `“${accessibleName(trigger) || 'That dropdown'}” is disabled.`);
  await prepare(trigger, 'Selecting', show);
  const press = (target: Element) => {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'] as const) {
      const Ev = type.startsWith('pointer') ? PointerEvent : MouseEvent;
      target.dispatchEvent(new Ev(type, { bubbles: true, cancelable: true, view: window }));
    }
  };
  trigger.focus();
  // Opened — unless its list is open already (a second press would close it).
  if (!ownLists(trigger).some((l) => l.querySelector('[role="option"]'))) press(trigger);
  // A search box: the choice typed in narrows the list (typed text alone is thrown away — the option is clicked).
  if (isInput(trigger) && !trigger.readOnly) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(trigger, option);
    trigger.dispatchEvent(new Event('input', { bubbles: true }));
  }
  // Its own list only (named once it is open) — never another dropdown's list still showing.
  const listOf = () => ownLists(trigger).flatMap((l) => Array.from(l.querySelectorAll<HTMLElement>('[role="option"]')));
  const wanted = optionNorm(option);
  const text = (o: Element) => (o.textContent ?? '').replace(/[✓✔]/g, '').trim();
  let match: HTMLElement | undefined;
  let seen: HTMLElement[] = [];
  for (let i = 0; i < 15 && !match; i++) {
    await new Promise((r) => setTimeout(r, 100));
    // The field's own list counts even while its opening animation has not shown it (a window in the background).
    seen = listOf().filter((o) => o.getAttribute('aria-disabled') !== 'true' && o.getAttribute('data-combobox-disabled') !== 'true');
    match =
      seen.find((o) => optionNorm(text(o)) === wanted) ??
      seen.find((o) => optionNorm(text(o)).startsWith(wanted)) ??
      seen.find((o) => optionNorm(text(o)).includes(wanted)) ??
      seen.find((o) => optionLoose(text(o)) === optionLoose(option));
  }
  if (!match) {
    // Nothing chosen: the typed text is taken out again, and the list closed.
    if (isInput(trigger) && !trigger.readOnly) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(trigger, '');
      trigger.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const all = listOf().map(text).filter(Boolean);
    await closeList(trigger);
    return fail('option_not_found', `There's no option “${option}” in “${accessibleName(trigger) || 'that dropdown'}”.`, all.length ? `Available: ${[...new Set(all)].slice(0, 40).join(' | ')}` : 'Its list did not open.');
  }
  match.scrollIntoView({ block: 'nearest' });
  press(match);
  await new Promise((r) => setTimeout(r, 250));
  return { element: summary(trigger), selected: text(match) };
}

/**
 * An Ant Design dropdown (the Smart Inbox's Provider, Recall Group, Description…): opened with a press on it,
 * narrowed by typing when it has a search box, scrolled through when its list is long (only the options in
 * view are on the page), and the option clicked. Null when it isn't one.
 */
export async function chooseInCustom(el: Element, option: string, show: boolean): Promise<SelectResult | null> {
  const box = el.closest('.ant-select') ?? el.querySelector('.ant-select');
  if (!box) return null;
  // Its label on the form, not its generated id (“rc_select_40”).
  const label = visualLabelInfo(box).text.replace(/[:*]\s*$/, '').trim();
  const own = accessibleName(el);
  const name = label || (own && !/^rc_select_/.test(own) ? own : '') || 'That dropdown';
  // One whose list follows another field (Description after Recall Group) opens a moment after that is chosen.
  for (let i = 0; i < 10 && box.matches('.ant-select-disabled'); i++) await sleep(300);
  if (box.matches('.ant-select-disabled')) fail('disabled', `“${name}” is disabled — it may need another field chosen first.`);
  await prepare(box, 'Selecting', show);
  const input = box.querySelector('input') as HTMLInputElement | null;
  const opener = box.querySelector('.ant-select-selector') ?? box;
  const openLists = () => Array.from(document.querySelectorAll('.ant-select-dropdown')).filter((d) => isVisible(d) && !d.matches('.ant-select-dropdown-hidden'));
  const ownList = (): Element | null => {
    const list = input?.getAttribute('aria-controls') || input?.getAttribute('aria-owns');
    return (list && document.getElementById(list)?.closest('.ant-select-dropdown')) || null;
  };
  // Its own list once it has one — never another dropdown's: a list left open by a choice that failed (“Abnormal”
  // in File) was searched for Status's “Abnormal”, and “isn't in the list” came back.
  // Not one that was open before this one was pressed: Ant makes a list the first time it opens, so until then this
  // one has none, and Status's list — still closing, or left open — was taken for File's: “Unfiled” wasn't in it, and
  // the model opened every dropdown by hand (12 calls for three filters).
  const stale = new Set(openLists().filter((d) => d !== ownList()));
  const popup = (): Element | null => {
    const own = ownList();
    if (own) return isVisible(own) && !own.matches('.ant-select-dropdown-hidden') ? own : null;
    return openLists().filter((d) => !stale.has(d)).at(-1) ?? null;
  };
  // Another dropdown still open: closed first, as a click elsewhere would.
  if (stale.size) {
    (document.activeElement as HTMLElement | null)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true } as KeyboardEventInit));
    for (const type of ['mousedown', 'mouseup']) document.body.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    await sleep(250);
  }
  // Its list is made the first time it opens, and slides in: wait for the options (up to 2 s), not a fixed moment —
  // after 350 ms the first time, it was still empty (“no option Abnormal”), and the model clicked its way round.
  // Still nothing open then: a second press, on its text box this time.
  const open = async (target: Element) => {
    dispatchPointerSequence(target);
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
    for (let i = 0; i < 20 && !popup()?.querySelector('.ant-select-item-option'); i++) await sleep(100);
  };
  if (!popup()) await open(opener);
  if (!popup()) await open(input ?? opener);
  else if (!popup()?.querySelector('.ant-select-item-option')) await sleep(300); // open, the options on their way
  const wanted = optionNorm(option);
  const textOf = (o: Element) => optionNorm(o.getAttribute('title') || (o as HTMLElement).innerText || '');
  const seen = new Set<string>();
  const find = (): Element | null => {
    const options = Array.from(popup()?.querySelectorAll('.ant-select-item-option') ?? []);
    for (const o of options) seen.add(((o as HTMLElement).innerText ?? '').trim());
    return (
      options.find((o) => textOf(o) === wanted) ??
      options.find((o) => textOf(o).startsWith(wanted)) ??
      options.find((o) => textOf(o).includes(wanted)) ??
      options.find((o) => optionLoose(textOf(o)) === optionLoose(option)) ??
      null
    );
  };
  let match = find();
  // A searchable one: type to narrow the list.
  if (!match && input && !input.readOnly && box.matches('.ant-select-show-search')) {
    setFieldValue(input, option, option);
    await sleep(500);
    match = find();
    // Worded unlike the option (“3 Months” for “3 Month(s)”): the whole list again, to look through.
    if (!match) {
      setFieldValue(input, '', null);
      await sleep(300);
      match = find();
    }
  }
  // A long list shows only what is in view: scroll through it.
  const holder = popup()?.querySelector('.rc-virtual-list-holder') as HTMLElement | null;
  for (let i = 0; !match && holder && i < 30 && holder.scrollTop + holder.clientHeight < holder.scrollHeight; i++) {
    holder.scrollTop += Math.max(40, holder.clientHeight - 20);
    holder.dispatchEvent(new Event('scroll', { bubbles: true }));
    await sleep(120);
    match = find();
  }
  if (!match) {
    // Leave it as it was: no search text behind, the list closed.
    if (input?.value) setFieldValue(input, '', null);
    input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const list = Array.from(seen).filter(Boolean).slice(0, 40);
    return fail('option_not_found', `There's no option “${option}” in “${name}”.`, list.length ? `Available: ${list.join(' | ')}` : 'Its list was empty — another field may need choosing first.');
  }
  const picked = ((match as HTMLElement).innerText ?? '').trim();
  dispatchPointerSequence(match);
  match.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
  await sleep(300);
  const shown = Array.from(box.querySelectorAll('.ant-select-selection-item')).map((c) => (c.getAttribute('title') || (c as HTMLElement).innerText || '').trim()).filter(Boolean);
  return { element: summary(el), selected: shown.join(', ') || picked };
}

function isScrollable(el: Element): boolean {
  if (el.scrollHeight <= el.clientHeight + 8) return false;
  const oy = getComputedStyle(el).overflowY;
  return oy === 'auto' || oy === 'scroll' || oy === 'overlay';
}

/** The window if it scrolls, otherwise the largest visible scrolling container (app shells). */
function scrollTarget(): Element {
  const se = document.scrollingElement ?? document.documentElement;
  if (se.scrollHeight > innerHeight + 8 && getComputedStyle(document.body).overflowY !== 'hidden') return se;
  let best: Element | null = null;
  let bestArea = 0;
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    if (!isScrollable(el)) continue;
    const r = el.getBoundingClientRect();
    const area = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) * Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    if (area > bestArea) {
      best = el;
      bestArea = area;
    }
  }
  return best ?? se;
}

export async function scroll(direction?: ScrollDirection, id?: number): Promise<ScrollResult> {
  if (id !== undefined) {
    const el = resolve(id);
    el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
    await sleep(150);
    const target = scrollTarget();
    return position(target, true);
  }
  const target = scrollTarget();
  const before = target.scrollTop;
  const page = (target === document.scrollingElement ? innerHeight : target.clientHeight) * 0.85;
  const top = direction === 'top' ? 0 : direction === 'bottom' ? target.scrollHeight : before + (direction === 'up' ? -page : page);
  target.scrollTo({ top, behavior: 'instant' as ScrollBehavior });
  await sleep(250); // let lazy content start loading
  return position(target, Math.abs(target.scrollTop - before) > 2);
}

function position(target: Element, moved: boolean): ScrollResult {
  const max = Math.max(0, target.scrollHeight - target.clientHeight);
  return {
    percent: max > 0 ? Math.round((target.scrollTop / max) * 100) : 0,
    atTop: target.scrollTop <= 2,
    atBottom: target.scrollTop >= max - 2,
    moved,
  };
}

const KEY_CODES: Record<string, { code: string; keyCode: number }> = {
  Enter: { code: 'Enter', keyCode: 13 },
  Escape: { code: 'Escape', keyCode: 27 },
  Tab: { code: 'Tab', keyCode: 9 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
  PageDown: { code: 'PageDown', keyCode: 34 },
  PageUp: { code: 'PageUp', keyCode: 33 },
  Space: { code: 'Space', keyCode: 32 },
};

export function normalizeKey(key: string): string {
  const k = key.trim();
  const map: Record<string, string> = { enter: 'Enter', return: 'Enter', esc: 'Escape', escape: 'Escape', tab: 'Tab', backspace: 'Backspace', delete: 'Delete', down: 'ArrowDown', up: 'ArrowUp', left: 'ArrowLeft', right: 'ArrowRight', arrowdown: 'ArrowDown', arrowup: 'ArrowUp', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', home: 'Home', end: 'End', pagedown: 'PageDown', pageup: 'PageUp', space: 'Space', ' ': 'Space' };
  return map[k.toLowerCase()] ?? k;
}

function focusables(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('a[href],button,input:not([type=hidden]),select,textarea,[tabindex]:not([tabindex="-1"]),[contenteditable=true]')).filter(
    (el) => !isDisabled(el) && isVisible(el),
  );
}

export async function pressKey(rawKey: string, id?: number): Promise<KeyResult> {
  const key = normalizeKey(rawKey);
  const target = (id !== undefined ? resolve(id) : (document.activeElement as Element | null)) ?? document.body;
  if (id !== undefined && isHTML(target)) target.focus({ preventScroll: true });
  const meta = KEY_CODES[key] ?? { code: key.length === 1 ? `Key${key.toUpperCase()}` : key, keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0 };
  const eventKey = key === 'Space' ? ' ' : key;
  const init: KeyboardEventInit = { key: eventKey, code: meta.code, keyCode: meta.keyCode, which: meta.keyCode, bubbles: true, cancelable: true, composed: true } as KeyboardEventInit;

  const down = new KeyboardEvent('keydown', init);
  const notCancelled = target.dispatchEvent(down);
  if (key === 'Enter') target.dispatchEvent(new KeyboardEvent('keypress', { ...init, charCode: 13 } as KeyboardEventInit));
  target.dispatchEvent(new KeyboardEvent('keyup', init));

  let submittedForm = false;
  if (notCancelled) {
    if (key === 'Enter' && isInput(target) && target.form) {
      const invalidFields = invalidFieldsOf(target.form);
      if (invalidFields) return { submittedForm: false, invalidFields };
      // A real Enter in a single-line field submits its form; synthetic events don't.
      try {
        target.form.requestSubmit();
      } catch {
        target.form.submit();
      }
      submittedForm = true;
    } else if (key === 'Tab') {
      const list = focusables();
      const index = list.indexOf(target as HTMLElement);
      list[(index + 1) % list.length]?.focus();
    } else if ((key === 'Enter' || key === 'Space') && isHTML(target) && /button|link|checkbox|tab|menuitem|option/.test(roleOf(target)) && !(isInput(target))) {
      target.click();
    }
  }
  return { submittedForm };
}

/** Resolves once the DOM has been quiet for `quietMs` (or after `timeoutMs`). */
/** Visible alerts and invalid fields — validation errors, toasts, warnings. */
export function pageAlerts(): string[] {
  const out = new Set<string>();
  const selector = '[role=alert],[aria-live=assertive],.ant-form-item-explain-error,.ant-message-notice,.ant-notification-notice';
  for (const el of Array.from(document.querySelectorAll(selector))) {
    if (!isVisible(el)) continue;
    const text = ((el as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim();
    if (text && text.length < 200) out.add(text);
    if (out.size >= 6) break;
  }
  for (const el of Array.from(document.querySelectorAll('[aria-invalid=true]')).slice(0, 6)) {
    if (isVisible(el)) out.add(`“${accessibleName(el) || 'A field'}” is marked invalid`);
  }
  return [...out].slice(0, 8);
}

const TOASTS = '[role=alert],.ant-message-notice,.ant-notification-notice';

/** A save still on its way: a button saying “Saving…”, or one marked busy or loading. */
function stillSaving(): boolean {
  if (document.querySelector('.ant-btn-loading,[aria-busy=true]:not(body)')) return true;
  return Array.from(document.querySelectorAll('button')).some((b) => isVisible(b) && /^(saving|submitting|sending|please wait)\b/i.test((b.innerText ?? '').trim()));
}

export function settle(quietMs: number, timeoutMs: number): Promise<{ mutations: number; url: string; title: string; alerts: string[]; effect?: ClickEffect }> {
  return new Promise((done) => {
    let mutations = 0;
    // A toast that comes and goes while waiting (“Something went wrong”, “Saved”) is kept: it says how it went.
    const toasts = new Set<string>();
    let quietTimer = setTimeout(finish, quietMs);
    const hardTimer = setTimeout(() => finish(true), timeoutMs);
    const observer = new MutationObserver((records) => {
      mutations += records.length;
      for (const r of records) {
        for (const n of Array.from(r.addedNodes)) {
          if (!(n instanceof Element)) continue;
          for (const t of [n, ...Array.from(n.querySelectorAll(TOASTS))].filter((e) => e.matches(TOASTS))) {
            const text = ((t as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim();
            if (text && text.length < 200) toasts.add(text);
          }
        }
      }
      clearTimeout(quietTimer);
      quietTimer = setTimeout(finish, quietMs);
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    function finish(hard = false) {
      // Quiet, but the save hasn't answered yet: wait for its answer (up to the time limit).
      if (!hard && stillSaving()) {
        quietTimer = setTimeout(finish, quietMs);
        return;
      }
      observer.disconnect();
      clearTimeout(quietTimer);
      clearTimeout(hardTimer);
      const alerts = [...new Set([...pageAlerts(), ...toasts])].slice(0, 8);
      done({ mutations, url: location.href, title: document.title, alerts, effect: currentEffect() });
    }
  });
}

/**
 * The dialogs showing now — waiting up to `waitMs` for one to appear, since pages often open
 * them a moment after loading (“Add reason to view patient file”).
 */
export async function visibleDialogs(waitMs: number, settle = true): Promise<{ dialogs: DialogInfo[] }> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const dialogs = showingDialogs();
    if (dialogs.length) return { dialogs: settle ? await settledDialogs(dialogs) : dialogs };
    if (Date.now() >= deadline) return { dialogs };
    await sleep(250);
  }
}

/**
 * Pop-ups often come one after another (a reason to view the file, then the patient's alerts on
 * top of it): keep looking until the set has stayed the same for a moment.
 */
async function settledDialogs(first: DialogInfo[]): Promise<DialogInfo[]> {
  const sig = (ds: DialogInfo[]) => ds.map((d) => `${d.title}|${d.onTop ? 1 : 0}`).join('\n');
  const stop = Date.now() + 4000;
  let current = first;
  let stableSince = Date.now();
  while (Date.now() < stop && Date.now() - stableSince < 1500) {
    await sleep(250);
    const next = showingDialogs();
    if (sig(next) !== sig(current)) {
      current = next;
      stableSince = Date.now();
    }
  }
  return current;
}

export async function waitForText(text: string, timeoutMs: number): Promise<{ found: boolean }> {
  const wanted = text.toLowerCase();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((document.body?.innerText ?? '').toLowerCase().includes(wanted)) return { found: true };
    await sleep(250);
  }
  return { found: false };
}
