import { accessibleName, isVisible, visualLabelInfo } from './elements';
import { isInput, isSelect, isTextArea } from './dom';

/**
 * A form in a pop-up as the user sees it — every field by the name the page shows, whether it is
 * required (*), what it holds now and what it can take — read live each time, so it is never out
 * of date. The model then fills what the user gave and asks only for what is required and empty.
 */

const POPUPS = 'dialog,[role=dialog],[role=alertdialog],[aria-modal=true],.modal,.ui-dialog';
const DATE_MASK = /^(?:[_dD]{2}[/.-][_mM]{2}[/.-][_yY]{4}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})$/;
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const list = (items: string[], max = 12) => (items.length > max ? `${items.slice(0, max).join(' / ')} / … (${items.length} in all)` : items.join(' / '));

// Known pickers (select2, chosen, token/tag inputs, chips) — not any class with “tag” in it (“stage”).
const PICKER = '[class*=select2],[class*=chosen-],[class*=token-],[class*=tokenfield],[class*=tagsinput],[class*=tagit],[class*=chip],[class*=multiselect]';

/** The outermost box of a picker (a styled dropdown) around its small search field. */
export function pickerOf(field: Element): Element | null {
  let box: Element | null = null;
  let node = field.parentElement;
  for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) if (node.matches(PICKER)) box = node;
  return box;
}

export interface PickerState {
  /** Holds several choices (“To: PM Judy GILMOUR ×”) or one (“Location: All”). */
  several: boolean;
  chosen: string[];
  options: string[];
}

/** What a picker shows now, from the list it stands for (the page's hidden <select>) when there is one. */
export function pickerState(field: Element): PickerState | null {
  const box = pickerOf(field);
  if (!box) return null;
  const hidden = (box.previousElementSibling?.matches('select') ? box.previousElementSibling : box.parentElement?.querySelector('select')) as HTMLSelectElement | null;
  const options = hidden ? Array.from(hidden.options).map((o) => clean(o.text)).filter(Boolean) : [];
  const several = hidden ? hidden.multiple : !/single/.test(String(box.className));
  if (hidden && (hidden.selectedOptions.length || !several)) {
    return { several, chosen: Array.from(hidden.selectedOptions).map((o) => clean(o.text)).filter((t) => t && !/^-+\s*select\s*-+$/i.test(t)), options };
  }
  const CHIP = '[class*=choice],[class*=token],[class*=tag],[class*=chip]';
  const chips = Array.from(box.querySelectorAll(CHIP))
    .filter((c) => !c.querySelector(CHIP) && !c.matches('[class*=remove],[class*=close],input') && isVisible(c))
    .map((c) => clean((c as HTMLElement).innerText ?? '').replace(/\s*[×✕x]\s*$/i, ''))
    .filter((t) => t && !/^[×✕]$/.test(t));
  return { several, chosen: chips, options };
}

export function formFields(d: Element): string[] {
  const { lines } = readForm(d);
  return lines.length >= 3 ? lines.slice(0, 40) : [];
}

/** What the form holds now, by the names it shows — for the approval (fields that can't be changed left out). */
export function formValues(d: Element): { label: string; value: string }[] {
  return readForm(d).values.filter((v) => !v.fixed && v.value).map(({ label, value }) => ({ label, value }));
}

function readForm(d: Element): { lines: string[]; values: { label: string; value: string; fixed: boolean }[] } {
  // Not the fields of another pop-up opened inside this one.
  const own = (f: Element) => {
    const host = f.closest(POPUPS);
    return !host || host === d || !d.contains(host);
  };
  const fields = Array.from(d.querySelectorAll('input,select,textarea')).filter(
    (f) => own(f) && !(isInput(f) && ['hidden', 'button', 'submit', 'reset', 'image', 'file'].includes(f.type)) && isVisible(f),
  );
  const lines: string[] = [];
  const values: { label: string; value: string; fixed: boolean }[] = [];
  const radiosDone = new Set<string>();
  const pickersDone = new Set<Element>();
  for (const f of fields) {
    // A picker's label is beside its box, not beside the small search field inside it.
    const seen = visualLabelInfo(isInput(f) && pickerOf(f) ? pickerOf(f)! : f);
    const required = seen.required || f.hasAttribute('required') || f.getAttribute('aria-required') === 'true';
    const fixed = (f as HTMLInputElement).disabled || (f as HTMLInputElement).readOnly ? ' (can’t be changed here)' : '';
    if (isInput(f) && f.type === 'radio') {
      const group = f.name || seen.text;
      if (radiosDone.has(group)) continue;
      radiosDone.add(group);
      const radios = fields.filter((r) => isInput(r) && r.type === 'radio' && (r.name ? r.name === f.name : visualLabelInfo(r).text === seen.text)) as HTMLInputElement[];
      const options = radios.map((r) => `${accessibleName(r) || r.value}${r.checked ? ' (chosen)' : ''}`);
      const label = seen.text || 'Choice';
      lines.push(`- ${label}${required ? '*' : ''} — choose one: ${list(options)}${radios.some((r) => r.checked) ? '' : ' — none chosen'}`);
      const chosen = radios.find((r) => r.checked);
      if (seen.text && chosen) values.push({ label: seen.text, value: accessibleName(chosen) || chosen.value, fixed: !!fixed });
      continue;
    }
    if (isInput(f) && f.type === 'checkbox') {
      const name = accessibleName(f) || seen.text;
      if (name) lines.push(`- ${name} — tick box: ${f.checked ? 'ticked' : 'not ticked'}${fixed}`);
      if (name && f.checked) values.push({ label: name, value: 'Yes', fixed: !!fixed });
      continue;
    }
    // A mask (“__/__/____”) is not a name: the label the page shows is.
    const named = accessibleName(f).replace(/[:*]\s*$/, '');
    const name = seen.text || (/\p{L}/u.test(named) && !DATE_MASK.test(named) ? named : '');
    if (!name) continue;
    if (isSelect(f)) {
      const value = clean(f.selectedOptions[0]?.text ?? '');
      const options = Array.from(f.options).map((o) => clean(o.text)).filter((o) => o && !/^-+\s*select\s*-+$/i.test(o));
      const empty = !value || /^-+\s*select\s*-+$/i.test(value);
      lines.push(`- ${name}${required ? '*' : ''} — dropdown: ${empty ? 'empty' : `“${value}”`}; options: ${list(options)}${fixed}`);
      if (!empty) values.push({ label: name, value, fixed: !!fixed });
      continue;
    }
    const picker = pickerState(f);
    if (picker) {
      // One line per picker, however many small inputs it has.
      const box = pickerOf(f)!;
      if (pickersDone.has(box)) continue;
      pickersDone.add(box);
      const shown = picker.chosen.length ? picker.chosen.map((p) => `“${p}”`).join(', ') : 'empty';
      lines.push(
        picker.several
          ? `- ${name}${required ? '*' : ''} — picker that can hold several: ${shown} (add one: type its name and choose it; take one off: its “Unselect” ×)${fixed}`
          : `- ${name}${required ? '*' : ''} — dropdown: ${shown}${picker.options.length ? `; options: ${list(picker.options)}` : ''} (open it, type to narrow, choose)${fixed}`,
      );
      if (picker.chosen.length) values.push({ label: name, value: picker.chosen.join(', '), fixed: !!fixed });
      continue;
    }
    const value = clean((f as HTMLInputElement | HTMLTextAreaElement).value ?? '');
    const placeholder = f.getAttribute('placeholder') ?? '';
    const date = (isInput(f) && f.type === 'date') || DATE_MASK.test(placeholder) || DATE_MASK.test(value) || /date|dob/i.test(name);
    const kind = isTextArea(f) ? 'text box' : date ? 'date (DD/MM/YYYY)' : 'text';
    const blank = !value || /^[_\s/.:-]+$/.test(value);
    const shown = blank ? 'empty' : `“${value.length > 60 ? `${value.slice(0, 59)}…` : value}”`;
    lines.push(`- ${name}${required ? '*' : ''} — ${kind}: ${shown}${fixed}`);
    if (!blank) values.push({ label: name, value: value.length > 120 ? `${value.slice(0, 119)}…` : value, fixed: !!fixed });
  }
  return { lines, values };
}
