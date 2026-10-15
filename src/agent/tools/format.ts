import type { DialogInfo, ElementInfo, PageSnapshot } from '@/shared/types/page';

/**
 * Turns a page snapshot into compact text for the model. One line per element:
 *   [12] button "Add to cart" (disabled) in row 3 “MacBook Air” ↓
 */

/** Input types already conveyed by the role. */
const IMPLIED_TYPES = new Set(['text', 'submit', 'button', 'reset', 'image', 'search', 'checkbox', 'radio', 'number', 'range']);

const q = (s: string) => `"${s.replace(/"/g, "'")}"`;

export function formatElement(e: ElementInfo): string {
  const parts = [`[${e.id}]`, e.role === 'clickable' ? e.tag : e.role, e.name ? q(e.name) : '(no label — unknown action)'];
  if (e.type && !IMPLIED_TYPES.has(e.type) && e.type !== e.role) parts.push(`type=${e.type}`);
  if (e.value !== undefined && e.value !== '' && e.role !== 'link') parts.push(`value=${q(e.value)}`);
  else if (e.value === '' && /textbox|searchbox|combobox|spinbutton/.test(e.role)) parts.push('(empty)');
  if (e.placeholder) parts.push(`placeholder=${q(e.placeholder)}`);
  if (e.checked !== undefined) parts.push(e.checked ? '(checked)' : '(unchecked)');
  if (e.selected) parts.push('(selected)');
  if (e.hasMenu) parts.push('(opens a menu on hover — use hover or open_menu)');
  else if (e.expanded !== undefined) parts.push(e.expanded ? '(expanded)' : '(collapsed)');
  if (e.disabled) parts.push('(disabled)');
  if (e.required) parts.push('(required)');
  if (e.readonly) parts.push('(read-only)');
  if (e.inBlockingPopup) parts.push('(in a pop-up that can’t be closed — type only what the user tells you now)');
  if (e.options?.length) parts.push(`options: ${e.options.join(' | ')}`);
  if (e.href) parts.push(`→ ${e.href}`);
  if (e.context) parts.push(`in ${e.context}`);
  if (!e.inViewport) parts.push('↓');
  return parts.join(' ');
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

export function formatSnapshot(s: PageSnapshot, mode: 'overview' | 'content'): string {
  const lines: string[] = [];
  lines.push(`Page: ${s.title || '(untitled)'}`);
  lines.push(`URL: ${s.url}`);
  const where = s.scroll.atTop && s.scroll.atBottom ? 'whole page visible' : `scrolled ${s.scroll.percent}% of ${s.scroll.screens} screens${s.scroll.atBottom ? ' (at bottom)' : ''}`;
  lines.push(`Scroll: ${where}`);
  if (s.dialogs?.length) lines.push(formatDialogs(s.dialogs));
  else if (s.dialogOpen) lines.push('A dialog is open on top of the page.');
  if (s.frames.length) lines.push(`Embedded frames that can't be read: ${s.frames.slice(0, 5).join(', ')}`);
  lines.push('');

  lines.push('Interactive elements (↓ = outside the visible area):');
  if (!s.elements.length) lines.push('(none found — the page may still be loading)');
  for (const e of s.elements) lines.push(formatElement(e));
  if (s.omitted > 0) lines.push(`(+${s.omitted} more not listed — use find_element or scroll)`);

  if (s.headings.length && mode === 'overview') {
    lines.push('', 'Headings:', ...s.headings);
  }
  if (s.text) {
    lines.push('', mode === 'content' ? 'Page text:' : 'Visible text (start):', s.text);
    if (s.textTruncated) lines.push(mode === 'content' ? '(text truncated — scroll and read again for more)' : '(more text available — use read_page with mode "content")');
  }
  return lines.join('\n');
}
