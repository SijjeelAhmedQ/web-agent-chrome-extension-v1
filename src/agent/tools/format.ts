import type { DialogInfo, ElementInfo, PageSnapshot } from '@/shared/types/page';

/**
 * Turns a page snapshot into compact text for the model. One line per element:
 *   [12] button "Add to cart" (disabled) in row 3 “MacBook Air” ↓
 */

/** Input types already conveyed by the role. */
const IMPLIED_TYPES = new Set(['text', 'submit', 'button', 'reset', 'image', 'search', 'checkbox', 'radio', 'number', 'range']);

const q = (s: string) => `"${s.replace(/"/g, "'")}"`;

export function formatElement(e: ElementInfo): string {
  return elementLine(e, 'with');
}

/**
 * An element as one line. `place`: 'with' its place (“in row 3 “…””), 'same' — the line above's place, said
 * again in short — or 'none', when a line of several gives the place once for all of them.
 */
function elementLine(e: ElementInfo, place: 'with' | 'same' | 'none', offscreen = !e.inViewport): string {
  const samePlaceAsAbove = place === 'same';
  const parts = [`[${e.id}]`, e.role === 'clickable' ? e.tag : e.role, e.name ? q(e.name) : '(no label — unknown action)'];
  if (e.type && !IMPLIED_TYPES.has(e.type) && e.type !== e.role) parts.push(`type=${e.type}`);
  // The whole value (as the snapshot caps it), in an overview too: cut to 80 characters, a record's discharge
  // summary written in its comment box lost its details, and the model summarised it from the cut.
  if (e.value !== undefined && e.value !== '' && e.role !== 'link') parts.push(`value=${q(e.value)}`);
  else if (e.value === '' && /textbox|searchbox|combobox|spinbutton/.test(e.role)) parts.push('(empty)');
  if (e.label) parts.push(`label ${q(e.label)}`);
  if (e.placeholder) parts.push(`placeholder=${q(e.placeholder)}`);
  if (e.checked !== undefined) parts.push(e.checked ? '(checked)' : '(unchecked)');
  if (e.selected) parts.push('(selected)');
  if (e.hasMenu) parts.push('(hover menu: open_menu)');
  else if (e.expanded !== undefined) parts.push(e.expanded ? '(expanded)' : '(collapsed)');
  if (e.disabled) parts.push('(disabled)');
  if (e.required) parts.push('(required)');
  if (e.readonly) parts.push('(read-only)');
  if (e.inBlockingPopup) parts.push('(in a pop-up that can’t be closed — type only what the user tells you now)');
  if (e.options?.length) parts.push(`options: ${e.options.join(' | ')}`);
  if (e.href) parts.push(`→ ${e.href}`);
  if (e.context && place !== 'none') parts.push(samePlaceAsAbove ? (/^row /.test(e.context) ? '(same row)' : '(same place)') : `in ${e.context}`);
  if (offscreen) parts.push('↓');
  return parts.join(' ');
}

const FIELD = /textbox|searchbox|combobox|spinbutton|listbox|slider/;

/** Controls side by side in one place (a menu's group, a row's icons), in a line of their own — at most this many. */
const PER_LINE = 12;

/**
 * The element list: controls in the same place (a table row, a menu's group, a pop-up) one line for them all, the
 * place said once — `in row 9 “…”: [4716] button "Move up" · [4717] button "Edit station"`. A line each, the
 * place said again for each (“(same place)”), the side menu alone was some 1,300 tokens of every page read.
 */
function elementLines(elements: ElementInfo[], before?: Map<number, string>): string[] {
  const lines: string[] = [];
  // Read before, just so, on another page of the same app (its side menu): the place, and each one's id and name.
  const asBefore = (x: ElementInfo) => !!before && before.get(x.id) === formatElement(x).replace(/ ↓$/, '');
  // A form's fields keep a line each: their values, labels and choices are long, and each is filled on its own.
  const joins = (x: ElementInfo) => !FIELD.test(x.role) && !x.options?.length;
  for (let i = 0; i < elements.length; ) {
    const e = elements[i];
    let j = i + 1;
    // (On screen or below it: a line is one or the other — one that doesn't fit drops those below whole.)
    while (e.context && joins(e) && j < elements.length && j - i < PER_LINE && elements[j].context === e.context && elements[j].inViewport === e.inViewport && joins(elements[j])) j++;
    if (j - i < 2) {
      lines.push(elementLine(e, !!e.context && i > 0 && elements[i - 1].context === e.context ? 'same' : 'with'));
    } else {
      const group = elements.slice(i, j);
      const below = e.inViewport ? '' : ' ↓';
      if (group.every(asBefore)) lines.push(`in ${e.context} (as on the page before): ${group.map((x) => `[${x.id}] ${x.name ? q(x.name) : x.role}`).join(' · ')}${below}`);
      else lines.push(`in ${e.context}: ${group.map((x) => elementLine(x, 'none', false)).join(' · ')}${below}`);
    }
    i = j;
  }
  return lines;
}

/** The form in the pop-up in front, field by field — read live. */
export function formSection(d: DialogInfo): string {
  return [`The form in the pop-up “${d.title || 'Pop-up'}” now (* = required; fill what the user gave, ask only for a required field that is empty and that the user didn't give):`, ...(d.form ?? [])].join('\n');
}

/** Pop-ups on top of the page, each with the control that closes it — or a note that it has none. */
export function formatDialogs(dialogs: DialogInfo[]): string {
  const stacked = dialogs.some((d) => d.onTop) && dialogs.some((d) => !d.onTop);
  const lines = dialogs.map((d) => {
    const how = d.close ? `can be closed: [${d.close.id}] ${d.close.role === 'clickable' ? d.close.tag : d.close.role} ${q(d.close.name || '×')}` : 'has no ×, Close or Cancel button';
    return `- ${q(d.title || 'Pop-up')}${d.onTop && stacked ? ' (in front)' : ''} — ${how}. Shows: ${q(d.text)}`;
  });
  return [stacked ? 'Pop-ups showing on top of the page (the one in front first — it covers the others):' : 'Pop-ups showing on top of the page:', ...lines].join('\n');
}

/**
 * `before`: the elements' lines as the last read gave them, when that was another page of the same document (an
 * app's pages, one after another): what is there as it was — its side menu, some 60 links — is said in short.
 */
export function formatSnapshot(s: PageSnapshot, mode: 'overview' | 'content', before?: Map<number, string>): string {
  const lines: string[] = [];
  lines.push(`Page: ${s.title || '(untitled)'}`);
  lines.push(`URL: ${s.url}`);
  const where = s.scroll.atTop && s.scroll.atBottom ? 'whole page visible' : `scrolled ${s.scroll.percent}% of ${s.scroll.screens} screens${s.scroll.atBottom ? ' (at bottom)' : ''}`;
  lines.push(`Scroll: ${where}`);
  if (s.dialogs?.length) {
    lines.push(formatDialogs(s.dialogs));
    // Before the element list, so it is kept when a long page has to be shortened.
    const front = s.dialogs[0];
    if (front.form?.length) lines.push(formSection(front));
    if (front.fullText) lines.push(`All the text of the pop-up “${front.title || 'Pop-up'}”${s.dialogs.length > 1 ? ' (in front)' : ''}:`, front.fullText);
  }
  else if (s.dialogOpen) lines.push('A dialog is open on top of the page.');
  if (s.frames.length) lines.push(`Embedded frames that can't be read: ${s.frames.slice(0, 5).join(', ')}`);
  lines.push('');

  lines.push('Interactive elements (↓ = outside the visible area):');
  if (!s.elements.length) lines.push('(none found — the page may still be loading)');
  // A table row's icons (details, edit, task, payment…) or a pop-up's fields share their place: say it once.
  lines.push(...elementLines(s.elements, mode === 'overview' ? before : undefined));
  if (s.omitted > 0) lines.push(`(+${s.omitted} more not listed — a long table's later rows among them: use find_element, read_table or scroll)`);
  if (s.behindPopup) lines.push(`(${s.behindPopup} controls of the page behind the pop-up are left out: they can't be used while it is open. Every field and button of the form is in the pop-up — a control with the same name behind it, a list's filter, is not the form's.)`);

  if (s.headings.length && mode === 'overview') {
    lines.push('', 'Headings:', ...s.headings);
  }
  // The start of a page's text is mostly its controls' names, listed above. Reading (content) keeps every line: a value in a table may be one.
  const named = new Set(s.elements.map((e) => e.name.trim()));
  const text = mode === 'overview' ? s.text.split('\n').filter((l) => !named.has(l.trim())).join('\n') : s.text;
  if (text.trim()) {
    lines.push('', mode === 'content' ? 'Page text:' : 'Visible text (start):', text);
    if (s.textTruncated) lines.push(mode === 'content' ? '(text truncated — scroll and read again for more)' : '(more text available — use read_page with mode "content")');
  }
  return lines.join('\n');
}
