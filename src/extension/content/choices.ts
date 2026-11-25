import { isVisible } from './elements';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Opens a dropdown the way a user does (pointer down, up, click), so its library sees it. */
export function pressOpen(el: Element) {
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'] as const) {
    const Ev = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    el.dispatchEvent(new Ev(type, { bubbles: true, cancelable: true, view: window }));
  }
}

/** The field says it opens a list (and so names that list once it is open: aria-controls). */
const opensList = (el: Element) => el.getAttribute('aria-haspopup') === 'listbox' || el.getAttribute('role') === 'combobox';

/**
 * The list that belongs to this field: the one it points at (aria-controls / aria-owns), or its datalist. Only a field
 * that does not say it opens a list falls back to the list showing now — another dropdown's list left open must never
 * be read as this one's (libraries name a field's list only while it is open, and keep closed ones in the page).
 */
export function listOf(el: Element): HTMLElement[] {
  const ids = [el.getAttribute('aria-controls'), el.getAttribute('aria-owns')].flatMap((v) => (v ? v.split(/\s+/) : []));
  const own = ids.map((id) => document.getElementById(id)).filter((l): l is HTMLElement => !!l);
  if (el instanceof HTMLInputElement && el.list) own.push(el.list);
  if (own.length || opensList(el)) return own;
  return Array.from(document.querySelectorAll<HTMLElement>('[role="listbox"]')).filter(isVisible);
}

/** Waits for the field's own list once it was opened (up to ~1.2 s). */
export async function waitForList(el: Element): Promise<HTMLElement[]> {
  for (let i = 0; i < 12; i++) {
    const lists = listOf(el);
    if (lists.some((l) => l.querySelector('[role="option"], option'))) return lists;
    await sleep(100);
  }
  return listOf(el);
}

/** Closes a list that was opened to read or choose: the field loses focus and a click lands outside it. */
export async function closeList(el: Element) {
  if (el instanceof HTMLElement) el.blur();
  el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  for (const type of ['pointerdown', 'mousedown', 'mouseup'] as const) {
    const Ev = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    document.body.dispatchEvent(new Ev(type, { bubbles: true, cancelable: true, view: window }));
  }
  await sleep(150);
}

const optionText = (o: Element) => (o.textContent?.trim() || o.getAttribute('value') || '').replace(/\s+/g, ' ').replace(/[✓✔]\s*$/, '').trim();

/**
 * A dropdown's choices: read from its own list — opened first when it is not open (and closed again after), since
 * libraries name a field's list only while it shows. Nothing is chosen.
 */
export async function choicesOf(el: Element): Promise<{ options: string[] }> {
  let lists = listOf(el).filter((l) => l.querySelector('[role="option"], option'));
  let opened = false;
  if (!lists.length && opensList(el)) {
    pressOpen(el);
    opened = true;
    lists = await waitForList(el);
  }
  const options = lists.flatMap((l) => Array.from(l.querySelectorAll('[role="option"], option')).map(optionText));
  if (opened) await closeList(el);
  return { options: [...new Set(options.filter(Boolean))].slice(0, 300) };
}
