import type {
  ClickResult,
  ContentError,
  KeyResult,
  ScrollDirection,
  ScrollResult,
  SelectResult,
  TypeResult,
} from '../messaging/protocol';
import { accessibleName, elementFor, hasHiddenMenu, isDisabled, isEditable, isVisible, roleOf } from './elements';
import { isHovered, openHoverMenu, releaseHoverUnlessInside } from './hover';
import { highlight } from './overlay';

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

function reveal(el: Element) {
  const r = el.getBoundingClientRect();
  if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) {
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
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

function dispatchPointerSequence(el: Element) {
  const view = el.ownerDocument.defaultView ?? window;
  const point = centerOf(el);
  const base = { bubbles: true, cancelable: true, composed: true, view, button: 0, ...point };
  el.dispatchEvent(new PointerEvent('pointerover', { ...base, pointerType: 'mouse', isPrimary: true }));
  el.dispatchEvent(new MouseEvent('mouseover', base));
  el.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerType: 'mouse', isPrimary: true, buttons: 1 }));
  el.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
  if (el instanceof HTMLElement) el.focus({ preventScroll: true });
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
  (el instanceof HTMLButtonElement && el.type === 'submit') || (el instanceof HTMLInputElement && (el.type === 'submit' || el.type === 'image'));

export async function click(id: number, show: boolean): Promise<ClickResult> {
  const el = resolve(id);
  if (!isVisible(el) && !(el instanceof HTMLInputElement)) fail('not_visible', 'That element is hidden right now.', 'It may be inside a closed menu or collapsed section. Open the menu first or scroll.');
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
  dispatchPointerSequence(el);
  if (el instanceof HTMLElement) el.click();
  else el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, ...centerOf(el) }));
  return { element: summary(el), covered: covered || undefined, invalidFields };
}

const nativeSetter = (el: HTMLInputElement | HTMLTextAreaElement) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  return Object.getOwnPropertyDescriptor(proto, 'value')?.set;
};

/** Finds the actual text field for a container (custom comboboxes wrap an <input>). */
function editableTarget(el: Element): HTMLInputElement | HTMLTextAreaElement | HTMLElement {
  if (isEditable(el)) return el;
  const inner = el.querySelector('input:not([type=hidden]),textarea,[contenteditable=""],[contenteditable=true]');
  if (inner && isEditable(inner)) return inner;
  const forLabel = el instanceof HTMLLabelElement ? el.control : null;
  if (forLabel && isEditable(forLabel)) return forLabel;
  return fail('not_editable', `“${accessibleName(el) || 'That element'}” isn't a text field.`, 'Pick a textbox, searchbox or combobox from read_page.');
}

function setFieldValue(field: HTMLInputElement | HTMLTextAreaElement, value: string, data: string | null) {
  const setter = nativeSetter(field);
  if (setter) setter.call(field, value);
  else field.value = value;
  field.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: data ? 'insertText' : 'deleteContentBackward', data }));
}

export async function type(id: number, text: string, clearFirst: boolean, show: boolean): Promise<TypeResult> {
  const el = resolve(id);
  if (isDisabled(el)) fail('disabled', `“${accessibleName(el) || 'That field'}” is disabled.`);
  const field = editableTarget(el);
  await prepare(field, 'Typing', show);
  field.focus({ preventScroll: true });
  dispatchPointerSequence(field);

  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    const start = clearFirst ? '' : field.value;
    if (clearFirst && field.value) setFieldValue(field, '', null);
    // Key events per character for autocompletes that listen to keys; value set in one go.
    const last = text.slice(-1);
    field.dispatchEvent(new KeyboardEvent('keydown', { key: last, bubbles: true, composed: true }));
    setFieldValue(field, start + text, text);
    field.dispatchEvent(new KeyboardEvent('keyup', { key: last, bubbles: true, composed: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    return { element: summary(el), value: field.type === 'password' ? '••••' : field.value };
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
  // execCommand is deprecated but remains the only way to type into editors the way a user does.
  const inserted = doc.execCommand('insertText', false, text);
  if (!inserted) {
    if (clearFirst) field.textContent = text;
    else field.textContent = (field.textContent ?? '') + text;
    field.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
  }
  return { element: summary(el), value: (field.innerText ?? '').slice(0, 200) };
}

export async function clear(id: number, show: boolean): Promise<TypeResult> {
  const el = resolve(id);
  const field = editableTarget(el);
  await prepare(field, 'Clearing', show);
  field.focus({ preventScroll: true });
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
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

export async function select(id: number, option: string, show: boolean): Promise<SelectResult> {
  const el = resolve(id);
  const native = el instanceof HTMLSelectElement ? el : el.querySelector('select');
  if (!native) {
    return fail('not_native_select', `“${accessibleName(el) || 'That control'}” is a custom dropdown.`, 'Click it to open the list, then click the option you want (read_page after opening).');
  }
  if (native.disabled) fail('disabled', `“${accessibleName(native)}” is disabled.`);
  const wanted = optionNorm(option);
  const options = Array.from(native.options);
  const match =
    options.find((o) => optionNorm(o.text) === wanted || optionNorm(o.value) === wanted) ??
    options.find((o) => optionNorm(o.text).startsWith(wanted)) ??
    options.find((o) => optionNorm(o.text).includes(wanted));
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
  if (id !== undefined && target instanceof HTMLElement) target.focus({ preventScroll: true });
  const meta = KEY_CODES[key] ?? { code: key.length === 1 ? `Key${key.toUpperCase()}` : key, keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0 };
  const eventKey = key === 'Space' ? ' ' : key;
  const init: KeyboardEventInit = { key: eventKey, code: meta.code, keyCode: meta.keyCode, which: meta.keyCode, bubbles: true, cancelable: true, composed: true } as KeyboardEventInit;

  const down = new KeyboardEvent('keydown', init);
  const notCancelled = target.dispatchEvent(down);
  if (key === 'Enter') target.dispatchEvent(new KeyboardEvent('keypress', { ...init, charCode: 13 } as KeyboardEventInit));
  target.dispatchEvent(new KeyboardEvent('keyup', init));

  let submittedForm = false;
  if (notCancelled) {
    if (key === 'Enter' && target instanceof HTMLInputElement && target.form) {
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
    } else if ((key === 'Enter' || key === 'Space') && target instanceof HTMLElement && /button|link|checkbox|tab|menuitem|option/.test(roleOf(target)) && !(target instanceof HTMLInputElement)) {
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

export function settle(quietMs: number, timeoutMs: number): Promise<{ mutations: number; url: string; title: string; alerts: string[] }> {
  return new Promise((done) => {
    let mutations = 0;
    let quietTimer = setTimeout(finish, quietMs);
    const hardTimer = setTimeout(finish, timeoutMs);
    const observer = new MutationObserver((records) => {
      mutations += records.length;
      clearTimeout(quietTimer);
      quietTimer = setTimeout(finish, quietMs);
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    function finish() {
      observer.disconnect();
      clearTimeout(quietTimer);
      clearTimeout(hardTimer);
      done({ mutations, url: location.href, title: document.title, alerts: pageAlerts() });
    }
  });
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
