import type { CrawlerSettings } from '@/shared/types/config';
import type { ElementInfo } from '@/shared/types/page';
import { DEFAULT_ASK_WORDS, DEFAULT_SAME_SCREEN_WORDS } from '@/shared/constants/crawlerWords';

export { DEFAULT_ASK_WORDS, DEFAULT_SAME_SCREEN_WORDS };

/**
 * What the crawler never does on its own. It clicks everything else, but a control whose name has one of the
 * “ask before” words (Crawler settings — any language, any site), a form's submit button, or a sign-out link waits
 * for the user's OK. There is no switch to turn the asking off.
 */

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A word list as one pattern: whole words, any case, any script (Unicode letters count as word characters). */
export function wordsPattern(words: string[], whole = false): RegExp | null {
  const list = words.map((w) => w.trim()).filter(Boolean).map((w) => escape(w).replace(/\s+/g, '\\s*-?\\s*'));
  if (!list.length) return null;
  const body = `(${list.join('|')})`;
  return whole ? new RegExp(`^${body}(?![\\p{L}\\p{N}])`, 'iu') : new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'iu');
}

/**
 * Controls that change a record's place or state without a word of the editable list — always asked about, whatever
 * the settings say (a list saved before these were added doesn't have them). “Move Tall Table 2 down” swapped two
 * stations' order on a real site while it was being learned.
 */
export const ALWAYS_ASK_WORDS = [
  'move', 'reorder', 're-order', 'sort order', 'move up', 'move down', 'drag', 'rank',
  'duplicate', 'clone', 'copy to', 'enable', 'activate', 'reactivate', 'assign', 'unassign', 'reassign',
  'pin', 'unpin', 'star', 'unstar', 'favourite', 'favorite', 'set as default', 'make default', 'set default', 'make primary', 'set primary',
  'check in', 'check out', 'start consult', 'end consult', 'arrive', 'mark',
];

/** A table row's control that is only an arrow (↑ ↓ ▲ ▼): in a row it moves that record, it does not page the list. */
const ROW_ARROW = /^\s*[↑↓⇧⇩▲▼⬆⬇]+\s*$/;

/** Why clicking this needs the user's OK, or null when it is only looking around. */
export function dangerOf(el: Pick<ElementInfo, 'name' | 'role' | 'type' | 'href' | 'label' | 'context'>, askWords: string[] = DEFAULT_ASK_WORDS): string | null {
  const name = `${el.name ?? ''} ${el.label ?? ''}`.trim();
  if (el.type === 'submit' || el.type === 'reset') return 'submits a form';
  if (el.href && /(log-?out|sign-?out|log-?off)/i.test(el.href)) return 'signs you out';
  if (ROW_ARROW.test(name) && /\brow \d+/i.test(el.context ?? '')) return 'moves this row (changes the order)';
  const hit = wordsPattern(askWords)?.exec(name) ?? wordsPattern(ALWAYS_ASK_WORDS)?.exec(name);
  return hit ? `may change data (“${hit[1]}”)` : null;
}

/** A control that only pages through the same list or calendar, or folds a panel. */
export function isSameScreen(label: string, words: string[] = DEFAULT_SAME_SCREEN_WORDS): boolean {
  const t = label.trim();
  if (/^[«»‹›<>←→↑↓]+$/.test(t) || /^\d+$/.test(t)) return true;
  return !!wordsPattern(words, true)?.test(t);
}

const TEXT_ROLES = new Set(['textbox', 'searchbox', 'spinbutton', 'combobox']);

/** The dummy value for a field (forms are filled to see what they ask, never submitted), or null to leave it. */
export function dummyFor(el: ElementInfo, s: CrawlerSettings): string | null {
  if (!TEXT_ROLES.has(el.role) || el.disabled || el.readonly) return null;
  // A searchable select: typed text only filters its list (and is thrown away when nothing matches) — its options are read instead.
  if (el.picks) return null;
  if (el.value && el.value.trim()) return null;
  // The field shows an example of what it takes — in it (“e.g. ABC1235”) or in its help under it (“Use latitude,
  // longitude, e.g. -36.8485,174.7633”): that is the test value, not a word it would refuse.
  const example = exampleIn(el.placeholder ?? '') ?? exampleIn(el.hint ?? '');
  if (example && el.type !== 'password') return example;
  const words = `${el.name} ${el.label ?? ''} ${el.placeholder ?? ''}`.toLowerCase();
  const type = (el.type ?? '').toLowerCase();
  // The field's type says it first (any language); then its words.
  if (type === 'email' || /e-?mail/.test(words)) return s.email;
  if (type === 'password' || /password|passcode|\bpin\b/.test(words)) return s.password;
  if (type === 'tel' || /phone|mobile|cell|contact no|\btel\b/.test(words)) return s.phone;
  // A colour: a colour code (a word like “Test” is refused).
  if (type === 'color' || /\bcolou?r\b|\bhex\b/.test(words) || /^#[0-9a-f]{3,8}$/i.test(el.placeholder ?? '')) return '#2563EB';
  if (type === 'number' || el.role === 'spinbutton') return s.number;
  if (['date', 'datetime-local', 'month', 'week', 'time'].includes(type) || /\bdate\b|dob|birth/.test(words)) return null; // date pickers: left alone
  if (el.role === 'combobox') return null; // dropdowns: their options are read, not chosen
  if (/\b(first|last|full|sur|user)?\s*name\b/.test(words)) return s.name;
  if (/\b(age|qty|quantity|amount|count|number)\b/.test(words)) return s.number;
  return s.text;
}

/**
 * The example a field or a message gives of a valid value — “e.g. ABC1235”, “for example -36.8485,174.7633”,
 * “eg: 021 555 0100” — or null. A form's own example passes its check where a generic test value may not.
 */
export function exampleIn(text: string): string | null {
  const m = /\b(?:e\.\s?g\.?|eg|for example|example|such as|z\.\s?b\.?|p\.\s?ej\.?|ex\.?)\s*[:,]?\s*([^\s][^;|]*?)\s*(?:[;|)]|\.\s|\.$|$)/i.exec(text);
  const v = m?.[1]?.replace(/^["“']|["”']$/g, '').trim();
  return v && v.length <= 60 ? v : null;
}
