import type { VisualRow } from '@/shared/types/page';

/**
 * A record's results by their flag column — “HbA1c  Status  Abnormal” — worked out by code, not by the
 * model: counting six records' tests by eye is where models slip. Which word heads the flag and which
 * values are normal come from the site's knowledge (read_records' arguments), not from here.
 */

export interface StatusRow {
  test: string;
  status: string;
}

export interface StatusRules {
  /** The word before each result's flag, e.g. "Status". */
  label: string;
  /** Flags that mean normal, e.g. ["Normal"]. */
  normal: string[];
  /** An empty flag means normal (a site that leaves Normal out once a record is saved). */
  emptyIsNormal: boolean;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The result rows of a record's text: each test with its flag (empty when the row has none). */
export function statusRows(text: string, label: string): StatusRow[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  // Within a line the label is matched as written (“Status”): prose (“the status of…”) is not a row.
  const inLine = new RegExp(`^(.*\\S)\\s+${escape(label)}(?:\\s+(.*))?$`);
  const leading = new RegExp(`^${escape(label)}\\s+(.+)$`);
  // A field (“File Status: Filed”) or a heading (“Status:”) is not a result row.
  const field = (s: string) => /[:：]/.test(s);
  const rows: StatusRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (same(line, label)) {
      // On lines of their own: test, label, flag — or test, label, the next test (an empty flag).
      const test = lines[i - 1];
      if (!test || field(test) || same(test, label)) continue;
      const after = lines[i + 1];
      const empty = !after || same(after, label) || field(after) || (lines[i + 2] !== undefined && same(lines[i + 2], label));
      rows.push({ test, status: empty ? '' : after });
      continue;
    }
    const lead = line.match(leading);
    if (lead && !field(lead[1]) && lines[i - 1] && !field(lines[i - 1])) {
      rows.push({ test: lines[i - 1], status: lead[1].trim() });
      continue;
    }
    const m = line.match(inLine);
    if (m && !field(m[1]) && !(m[2] && field(m[2]))) rows.push({ test: m[1].trim(), status: (m[2] ?? '').trim() });
  }
  return rows;
}

const word = (s: string) => /^[\p{L}][\p{L} ()-]{0,24}$/u.test(s.trim());

/**
 * The result rows of a record as shown: test, the word in the middle column (“Status”, “Test”,
 * “Normal”… — it varies), then the flag in the right-hand column, or nothing there. The flag is the
 * right-hand cell, whatever the middle one says: “HbA1c | Normal | Abnormal” is abnormal.
 */
export function shownRows(rows: VisualRow[]): StatusRow[] {
  const out: StatusRow[] = [];
  for (const { cells } of rows) {
    if (cells.length < 2 || cells.length > 4) continue;
    const [test, middle] = cells;
    // Fields (“Name: Arya STARK”), dates and numbers are not results.
    if (cells.some((c) => /[:：]\s*$|^[^:]{1,30}:\s/.test(c)) || !/\p{L}{2}/u.test(test) || !word(middle)) continue;
    out.push({ test: test.trim(), status: cells.length >= 3 ? cells[cells.length - 1].trim() : '' });
  }
  return out;
}

export type Verdict = 'abnormal' | 'normal' | 'unclear' | 'none';

export function judge(rows: StatusRow[], rules: StatusRules): { verdict: Verdict; abnormal: StatusRow[]; normal: StatusRow[]; blank: StatusRow[] } {
  const abnormal: StatusRow[] = [];
  const normal: StatusRow[] = [];
  const blank: StatusRow[] = [];
  for (const row of rows) {
    if (!row.status) (rules.emptyIsNormal ? normal : blank).push(row);
    else if (rules.normal.some((n) => same(n, row.status))) normal.push(row);
    else abnormal.push(row);
  }
  const verdict: Verdict = !rows.length ? 'none' : abnormal.length ? 'abnormal' : blank.length ? 'unclear' : 'normal';
  return { verdict, abnormal, normal, blank };
}

/** Which record it is, from its fields: “Testing · 21/10/2026”. */
function recordName(text: string): string {
  const fields = text.match(/^Fields — (.*)$/m)?.[1] ?? '';
  const value = (re: RegExp) => fields.split('; ').find((f) => re.test(f.split(':')[0]))?.split(/:\s*/).slice(1).join(':').trim();
  return [value(/subject|title/i), value(/date/i)].filter(Boolean).join(' · ');
}

/** Each record's verdict and the totals, for the top of read_records' result. */
export function statusSummary(records: { text: string; rows?: VisualRow[] }[], rules: StatusRules): string {
  const counts: Record<Verdict, number> = { abnormal: 0, normal: 0, unclear: 0, none: 0 };
  const lines = records.map(({ text, rows }, i) => {
    // The rows as shown when there are any (the flag is the right-hand cell); else the label in the text.
    const shown = rows?.length ? shownRows(rows) : [];
    const { verdict, abnormal, normal, blank } = judge(shown.length ? shown : statusRows(text, rules.label), rules);
    counts[verdict]++;
    const name = recordName(text);
    const head = `Record ${i + 1}${name ? ` (${name})` : ''}:`;
    if (verdict === 'none') return `${head} no result rows — a PDF, scan or letter: decide it from its text below.`;
    const parts = [
      abnormal.length ? `ABNORMAL — ${abnormal.map((r) => `${r.test}: ${r.status}`).join('; ')}` : verdict === 'normal' ? 'NORMAL' : 'UNCLEAR',
      normal.length ? `${normal.length} normal (${normal.map((r) => r.test).join(', ')})` : '',
      blank.length ? `${blank.length} with an empty flag (${blank.map((r) => r.test).join(', ')})` : '',
    ];
    return `${head} ${parts.filter(Boolean).join(' · ')}`;
  });
  const totals = [
    `${counts.abnormal} abnormal`,
    `${counts.normal} normal`,
    counts.unclear ? `${counts.unclear} unclear (a flag left empty)` : '',
    counts.none ? `${counts.none} to decide from the text (no result rows)` : '',
  ].filter(Boolean);
  return [
    `Results by each test's flag — the right-hand column (worked out from every row: a record is abnormal if any test's flag is not ${rules.normal.map((n) => `“${n}”`).join(' or ')}${rules.emptyIsNormal ? ' or empty' : ''}. These counts are final: use them, don't open the records again):`,
    ...lines,
    `Totals: ${records.length} record${records.length === 1 ? '' : 's'} — ${totals.join(', ')}.`,
  ].join('\n');
}
