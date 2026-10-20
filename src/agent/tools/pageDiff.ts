import type { PageSnapshot } from '@/shared/types/page';
import { formatDialogs, formatElement } from './format';

/**
 * Reading the same page again (after closing a pop-up, typing, opening a tab of it…) gives only what
 * changed since the last read — a 400-control page is ~8,000 tokens, and most of it is as it was.
 * The model keeps the last full read in its context (compaction never drops the base of a chain of
 * changes), so “everything not listed is as before” holds.
 */

/** The first line of a read that lists only changes — compaction keeps the full read before it. */
export const DIFF_HEAD = 'Page changes since your last read of this page';

/** What the agent last saw of a page, to compare the next read against. */
export interface PageMemo {
  doc: string;
  url: string;
  /** Each element's line without its “outside the visible area” mark — scrolling isn't a change. */
  lines: Map<number, string>;
  names: Map<number, string>;
  text: Set<string>;
}

const MAX_LISTED = 60;
const MAX_NEW_TEXT = 1_500;

const textLines = (text: string) => new Set(text.split('\n').map((l) => l.trim()).filter((l) => l.length > 2));
const steady = (line: string) => line.replace(/ ↓$/, '');

export function memoOf(snap: PageSnapshot): PageMemo | undefined {
  if (!snap.docId) return undefined;
  return {
    doc: snap.docId,
    url: snap.url,
    lines: new Map(snap.elements.map((e) => [e.id, steady(formatElement(e))])),
    names: new Map(snap.elements.map((e) => [e.id, e.name])),
    text: textLines(snap.text),
  };
}

/** The changes since `prev`, or null when this is another page (or another document at the same address). */
export function pageDiff(prev: PageMemo, snap: PageSnapshot): string | null {
  if (!snap.docId || prev.doc !== snap.docId || prev.url !== snap.url) return null;
  const added: string[] = [];
  const changed: string[] = [];
  const seen = new Set<number>();
  for (const e of snap.elements) {
    seen.add(e.id);
    const line = formatElement(e);
    const before = prev.lines.get(e.id);
    if (before === undefined) added.push(line);
    else if (before !== steady(line)) changed.push(line);
  }
  // Too much is new (a tab or panel opened): a list cut at MAX_LISTED would hide what the model needs — the whole page then.
  if (added.length + changed.length > MAX_LISTED) return null;
  const gone = [...prev.lines.keys()].filter((id) => !seen.has(id));
  const newText = [...textLines(snap.text)].filter((l) => !prev.text.has(l)).join('\n');

  const out = [`${DIFF_HEAD} — the same page: everything not listed here is as you last read it, and its ids still work. (read_page with full: true gives the whole page again.)`];
  out.push(`Page: ${snap.title || '(untitled)'}`, `URL: ${snap.url}`);
  const where = snap.scroll.atTop && snap.scroll.atBottom ? 'whole page visible' : `scrolled ${snap.scroll.percent}% of ${snap.scroll.screens} screens${snap.scroll.atBottom ? ' (at bottom)' : ''}`;
  out.push(`Scroll: ${where}`);
  if (snap.dialogs?.length) {
    out.push(formatDialogs(snap.dialogs));
    const front = snap.dialogs[0];
    if (front.fullText) out.push(`All the text of the pop-up “${front.title || 'Pop-up'}”${snap.dialogs.length > 1 ? ' (in front)' : ''}:`, front.fullText);
  } else out.push('No pop-ups are showing.');
  if (!added.length && !changed.length && !gone.length && !newText) {
    out.push('', 'Nothing else changed since your last read.');
    return out.join('\n');
  }
  const list = (title: string, lines: string[]) => {
    if (!lines.length) return;
    out.push('', `${title} (${lines.length}):`, ...lines.slice(0, MAX_LISTED));
    if (lines.length > MAX_LISTED) out.push(`(+${lines.length - MAX_LISTED} more)`);
  };
  list('New on the page', added);
  list('Changed (as they are now)', changed);
  if (gone.length) {
    const names = gone.slice(0, MAX_LISTED).map((id) => `[${id}] “${prev.names.get(id) ?? ''}”`);
    out.push('', `Gone from the page (${gone.length}): ${names.join(', ')}${gone.length > MAX_LISTED ? ` (+${gone.length - MAX_LISTED} more)` : ''}`);
  }
  if (newText) out.push('', 'New text on the page:', newText.length > MAX_NEW_TEXT ? `${newText.slice(0, MAX_NEW_TEXT)}…` : newText);
  return out.join('\n');
}
