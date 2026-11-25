import { accessibleName, idFor, isVisible, visualLabel } from './elements';

export interface FieldError {
  /** The field's id (as in a page read), to fill it again. */
  id: number;
  label: string;
  value: string;
  /** What the form says is wrong with it (empty: marked wrong with no words). */
  error: string;
}

const textOf = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const ERROR_CLASS = /(^|[-_\s])(error|invalid|danger|feedback|explain|help-?block|message)([-_\s]|$)/i;

/** The words the page shows as this field's error: aria-errormessage / aria-describedby, or an error text in its box. */
function errorOf(field: Element): string {
  const ids = [field.getAttribute('aria-errormessage'), field.getAttribute('aria-describedby')].flatMap((v) => (v ? v.split(/\s+/) : []));
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el && isVisible(el) && (field.getAttribute('aria-errormessage') === id || ERROR_CLASS.test(el.className.toString()) || el.getAttribute('role') === 'alert')) {
      const t = textOf(el);
      if (t) return t;
    }
  }
  // The text a form shows under the field (Mantine's …-error, Ant's …-explain-error, Bootstrap's invalid-feedback).
  let box: Element | null = field.parentElement;
  for (let level = 0; box && level < 4; level++, box = box.parentElement) {
    const found = Array.from(box.querySelectorAll('[role="alert"], [class*="error" i], [class*="invalid" i], [class*="explain" i]')).find(
      (e) => !e.contains(field) && !e.matches('input, textarea, select, button') && isVisible(e) && textOf(e).length > 0 && textOf(e).length < 200,
    );
    if (found) return textOf(found);
    // Stop at the field's own group: the next one up holds other fields' errors.
    if (box.querySelectorAll('input, textarea, select, [role="combobox"], [aria-haspopup="listbox"]').length > 1) break;
  }
  return field.getAttribute('aria-invalid') === 'true' ? '(marked wrong)' : '';
}

/**
 * After a save the form refused: each of its fields that shows an error, with the words — and the messages shown
 * for the whole form or as a notification (“A member with this NHI already exists”). `scope`: the pop-up's title.
 */
export function formErrors(scope?: string): { fields: FieldError[]; messages: string[] } {
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]')).filter(isVisible);
  const box = (scope && dialogs.find((d) => textOf(d).includes(scope.slice(-40)))) || dialogs[dialogs.length - 1] || document.body;
  const fields: FieldError[] = [];
  for (const f of Array.from(box.querySelectorAll('input:not([type="hidden"]), textarea, select, [role="combobox"], button[aria-haspopup="listbox"]'))) {
    const error = errorOf(f);
    if (!error) continue;
    const own = (f as HTMLInputElement).labels;
    const label = (own && own.length ? textOf(own[0]) : '') || visualLabel(f) || accessibleName(f) || f.getAttribute('placeholder') || '';
    fields.push({ id: idFor(f), label: label.replace(/[:*]\s*$/, '').trim(), value: (f as HTMLInputElement).value ?? textOf(f), error });
  }
  // Messages for the whole form, and notifications anywhere (a toast that says why it was refused).
  const notes = new Set<string>();
  for (const m of Array.from(document.querySelectorAll('[role="alert"], [role="status"], [aria-live="assertive"], [aria-live="polite"], [class*="notification" i], [class*="toast" i]'))) {
    if (!isVisible(m)) continue;
    const t = textOf(m);
    if (t && t.length < 300 && !fields.some((x) => x.error === t)) notes.add(t);
  }
  return { fields, messages: [...notes].slice(0, 10) };
}
