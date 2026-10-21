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

/** The choices shown in a picker that holds several (“PM Judy GILMOUR ×”), and the hidden list behind it. */
// Known multi-choice pickers (select2, chosen, token/tag inputs, chips) — not any class with “tag” in it (“stage”).
const PICKER = '[class*=select2],[class*=chosen-],[class*=token-],[class*=tokenfield],[class*=tagsinput],[class*=tagit],[class*=chip],[class*=multiselect]';

/** The outermost box of a picker that holds several choices, around its search field. */
function pickerOf(field: Element): Element | null {
  let box: Element | null = null;
  let node = field.parentElement;
  for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) if (node.matches(PICKER)) box = node;
  return box;
}

function pickedChoices(field: Element): string[] | null {
  const box = pickerOf(field);
  if (!box) return null;
  const hidden = box.parentElement?.querySelector('select[multiple]') as HTMLSelectElement | null;
  if (hidden?.selectedOptions.length) return Array.from(hidden.selectedOptions).map((o) => clean(o.text));
  const CHIP = '[class*=choice],[class*=token],[class*=tag],[class*=chip]';
  const chips = Array.from(box.querySelectorAll(CHIP))
    .filter((c) => !c.querySelector(CHIP) && !c.matches('[class*=remove],[class*=close],input') && isVisible(c))
    .map((c) => clean((c as HTMLElement).innerText ?? '').replace(/\s*[×✕x]\s*$/i, ''))
    .filter((t) => t && !/^[×✕]$/.test(t));
  return chips;
}

export function formFields(d: Element): string[] {
  // Not the fields of another pop-up opened inside this one.
  const own = (f: Element) => {
    const host = f.closest(POPUPS);
    return !host || host === d || !d.contains(host);
  };
  const fields = Array.from(d.querySelectorAll('input,select,textarea')).filter(
    (f) => own(f) && !(isInput(f) && ['hidden', 'button', 'submit', 'reset', 'image', 'file'].includes(f.type)) && isVisible(f),
  );
  const lines: string[] = [];
  const radiosDone = new Set<string>();
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
      continue;
    }
    if (isInput(f) && f.type === 'checkbox') {
      const name = accessibleName(f) || seen.text;
      if (name) lines.push(`- ${name} — tick box: ${f.checked ? 'ticked' : 'not ticked'}${fixed}`);
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
      continue;
    }
    const picked = pickedChoices(f);
    if (picked) {
      lines.push(`- ${name}${required ? '*' : ''} — picker that can hold several: ${picked.length ? picked.map((p) => `“${p}”`).join(', ') : 'empty'} (add one: type its name and choose it; remove one: its ×)${fixed}`);
      continue;
    }
    const value = clean((f as HTMLInputElement | HTMLTextAreaElement).value ?? '');
    const placeholder = f.getAttribute('placeholder') ?? '';
    const date = (isInput(f) && f.type === 'date') || DATE_MASK.test(placeholder) || DATE_MASK.test(value) || /date|dob/i.test(name);
    const kind = isTextArea(f) ? 'text box' : date ? 'date (DD/MM/YYYY)' : 'text';
    const blank = !value || /^[_\s/.:-]+$/.test(value);
    const shown = blank ? 'empty' : `“${value.length > 60 ? `${value.slice(0, 59)}…` : value}”`;
    lines.push(`- ${name}${required ? '*' : ''} — ${kind}: ${shown}${fixed}`);
  }
  return lines.length >= 3 ? lines.slice(0, 40) : [];
}
