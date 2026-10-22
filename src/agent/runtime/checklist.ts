import { z } from 'zod';
import type { ChecklistItem } from '@/shared/types/history';
import type { AgentTool } from '../tools/types';

/**
 * A request with several separate things to do (“add two medications and two diagnoses”) gets a
 * checklist: the model writes it once, ticks each item off as it finishes it, and sees the list
 * again before every step — so a long task (whose early steps fall out of a small context) doesn't
 * lose count, skip an item or add one twice.
 */
export class Checklist {
  items: ChecklistItem[];
  /** Items whose tick was held back once because the page didn't show what they quote. */
  asked = new Set<number>();

  constructor(items: ChecklistItem[] = []) {
    this.items = items.map((i) => ({ ...i }));
  }

  get size(): number {
    return this.items.length;
  }

  /** Item numbers (1-based) still to do. */
  pending(): number[] {
    return this.items.flatMap((item, i) => (item.done ? [] : [i + 1]));
  }

  format(): string {
    return this.items.map((item, i) => `${item.done ? '☑' : '☐'} ${i + 1}. ${item.text}${item.note ? ` — ${item.note}` : ''}`).join('\n');
  }

  /** The prompt section shown before every step. */
  section(): string {
    if (!this.size) return '';
    const next = this.pending()[0];
    return [
      '## Your checklist for this task',
      this.format(),
      next ? `Now: item ${next} — finish it completely, then call task_list with done: ${next}. Items marked ☑ are done: never do them again.` : 'Every item is done. Check the page, then answer the user.',
    ].join('\n');
  }

  /**
   * The done item `text` belongs to, when it names something only a finished item has — e.g.
   * typing “gabapentin 100 mg” again after that item is ticked (“gabapentin” alone could be the
   * next item too, so it is fine).
   */
  doneOnly(text: string): number | null {
    const t = norm(text);
    if (t.length < 4 || !/\p{L}/u.test(t)) return null;
    const has = (item: ChecklistItem) => norm(item.text).includes(t);
    if (this.items.some((item) => !item.done && has(item))) return null;
    const i = this.items.findIndex((item) => item.done && has(item));
    return i >= 0 ? i + 1 : null;
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[“”"'‘’]/g, '').replace(/\s+/g, ' ').trim();

/** The words an item quotes (“[web agent test] serial recall”) — a few words, not a single short name. */
const quotedIn = (text: string) => [...text.matchAll(/["“]([^"“”]{6,120})["”]/g)].map((m) => m[1].trim()).filter((q) => /\p{L}/u.test(q));

/** Several items may come as one string, one per line. */
const itemList = z.preprocess(
  (v) => (typeof v === 'string' ? v.split('\n').map((l) => l.replace(/^\s*(?:[-*•☐☑]|\d+[.)])\s*/, '').trim()).filter(Boolean) : v),
  z.array(z.string().min(1)).min(1),
);

/** The tool the model keeps its checklist with. `onChange` gets `done` when an item was just ticked. */
export function checklistTool(list: Checklist, onChange: (done: number | null) => void): AgentTool<{ items?: string[]; done?: number; note?: string }> {
  return {
    name: 'task_list',
    description:
      'Your checklist for a request with several separate things to do (e.g. two medications and two diagnoses). First call it with items: one item per thing, each with all the details the user gave for it, in the user’s order. Then do the items one at a time, and right after finishing one, call it with done: <its number> (and a short note, e.g. "added"). Tick an add only on proof of the one you added now (a success message, or a new entry with today’s date and time) — not an older record that looks the same. Not needed for a single task.',
    schema: z.object({
      items: itemList.optional().describe('The items, each with its details — only when making the list'),
      done: z.coerce.number().int().positive().optional().describe('The number of the item you just finished'),
      note: z.string().optional().describe('A few words on the result, e.g. "added" or "already there — skipped"'),
    }),
    risk: 'read',
    touchesPage: false,
    label: (a) => {
      if (a.items?.length && !list.items.some((i) => i.done)) return `Making a checklist of ${a.items.length} ${a.items.length === 1 ? 'task' : 'tasks'}`;
      if (a.done) return `Ticking off task ${a.done}${list.items[a.done - 1] ? `: ${list.items[a.done - 1].text}` : ''}`;
      return 'Checking the checklist';
    },
    async execute(a, ctx) {
      if (a.items?.length) {
        if (list.items.some((i) => i.done)) return { output: `The checklist is already made and items are done — don't make it again. Carry on with it:\n${list.format()}`, note: 'Checklist already made' };
        list.items = a.items.map((text) => ({ text: text.trim(), done: false }));
        onChange(null);
        return { output: `Checklist made. Do the items one at a time, starting with item 1; after finishing each, call task_list with done: <its number>.\n${list.format()}`, note: `${list.size} tasks` };
      }
      if (a.done) {
        const item = list.items[a.done - 1];
        if (!item) return { output: list.size ? `There is no item ${a.done}. The checklist:\n${list.format()}` : 'There is no checklist yet. Make one with items first.', note: 'No such task' };
        if (item.done) return { output: `Item ${a.done} is already ticked — don't do it again.\n${list.format()}`, note: 'Already ticked' };
        // The user's own words for it (a note, a subject) shown nowhere on the page: it may not have been
        // saved — an old record that looks alike is no proof. Asked once; a second tick is taken as checked.
        if (!list.asked.has(a.done)) {
          const quotes = quotedIn(item.text);
          const shown = await Promise.all(quotes.map((q) => Promise.resolve().then(() => ctx.browser.send({ kind: 'waitForText', text: q, timeoutMs: 400 })).then((r) => r.found, () => true)));
          if (quotes.length && !shown.some(Boolean)) {
            list.asked.add(a.done);
            return {
              output: `Not ticked yet: the page doesn't show ${quotes.map((q) => `“${q}”`).join(' or ')} from this item. A record that only looks alike (an older one) is no proof. Don't add it again — a second save makes a duplicate. Look where the site shows what was added (your site knowledge says where — e.g. a timeline). Seen it: call task_list with done: ${a.done} again. Saved but not shown there: tell the user it was saved but you can't see it, and ask where to look. Never saved (the form was refused or cancelled): then finish it.`,
              note: 'Not seen on the page yet',
            };
          }
        }
        item.done = true;
        if (a.note?.trim()) item.note = a.note.trim().slice(0, 80);
        onChange(a.done);
        const next = list.pending()[0];
        return {
          output: `${list.format()}\n${next ? `Next: item ${next} — ${list.items[next - 1].text}. Start it from the page as it is now.` : 'Every item is done. Check the page, then answer the user with each item and whether it was done.'}`,
          note: next ? `${list.size - list.pending().length} of ${list.size} done` : 'All done',
        };
      }
      return { output: list.size ? list.format() : 'There is no checklist yet.', note: list.size ? `${list.size - list.pending().length} of ${list.size} done` : 'No checklist' };
    },
  };
}
