import { z } from 'zod';
import type { AgentTool, ToolContext } from '../tools/types';

/**
 * Wrong clicks: stopped before they happen when they are plainly wrong (an icon in the row of the
 * record the user named, when the user asked to open that record), and undone when they happen
 * anyway (the model calls undo_click). Either way the user is told in the answer.
 */

const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 1);

/** Does the request name this item — every word of it (“Arya STARK” in “select arya stark”)? */
export function namedIn(request: string, item: string): boolean {
  const asked = new Set(words(request));
  const want = words(item);
  return want.length > 0 && want.every((w) => asked.has(w));
}

/** At most one letter added, dropped or changed (“stark” / “starkk”). */
function oneEditApart(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const rest = (x: string, skip: number) => x.slice(i + skip);
  return rest(a, 1) === rest(b, 1) || rest(a, 1) === rest(b, 0) || rest(a, 0) === rest(b, 1);
}

/**
 * Another name so like this one that the user may mean either — “Arya STARKK” for “Arya STARK”: the same words,
 * one of them (four letters or more) a letter apart. Not the same name: that is a plain match.
 */
export function nearlyNamed(name: string, other: string): boolean {
  const a = words(name);
  const b = words(other);
  if (!a.length || a.length !== b.length || a.join(' ') === b.join(' ')) return false;
  return a.every((w, i) => w === b[i] || (w.length >= 4 && oneEditApart(w, b[i])));
}

/** Words that describe a control rather than what it does. */
const GENERIC = new Set(['icon', 'button', 'image', 'link', 'the', 'and', 'for', 'open', 'click', 'here', 'more']);

/** Does the request ask for what this control does (“book appointment for arya stark” → “Book appointment”)? */
/** Words a user says for what a control is called otherwise (“delete” a recall = its “Inactive” icon). */
const SAME_ACTION: Record<string, string[]> = {
  delete: ['inactive', 'inactivate', 'deactivate', 'remove', 'trash', 'archive'],
  remove: ['inactive', 'inactivate', 'deactivate', 'delete', 'trash'],
  change: ['edit', 'update', 'modify'],
  update: ['edit', 'modify'],
  modify: ['edit', 'update'],
  finish: ['complete', 'done'],
  close: ['complete'],
};

function asksFor(request: string, control: string): boolean {
  const said = words(request);
  const asked = [...said, ...said.flatMap((w) => SAME_ACTION[w] ?? [])].filter((w) => w.length >= 4);
  const does = words(control).filter((w) => w.length >= 4 && !GENERIC.has(w));
  const stem = (w: string) => w.slice(0, 5);
  return does.some((d) => asked.some((a) => stem(a) === stem(d)));
}

const ROW_CONTROL = /^(image|clickable|button|link|cell|gridcell|menuitem)$/;

/**
 * A click on a control in the row of the record the user named — an icon (book, edit, payment,
 * print…) or something with no label — when the user did not ask for what it does: the record
 * opens from its name, and the icon does something else. Null when the click is fine.
 */
export function wrongRowClick(request: string, el: { name: string; role: string; context?: string } | undefined): { item: string; control: string } | null {
  if (!el?.context || !/^row /.test(el.context) || !ROW_CONTROL.test(el.role)) return null;
  const lead = el.context.match(/“(.*)”/)?.[1] ?? '';
  const item = lead.split(' · ').map((c) => c.trim()).find((c) => c && namedIn(request, c));
  if (!item) return null;
  const name = el.name.trim();
  if (name && (namedIn(request, name) || words(name).join(' ') === words(item).join(' ') || asksFor(request, name))) return null;
  return { item, control: name || 'a control with no label' };
}

/** The page around a click: which tab, which address, which pop-ups. */
export interface PageState {
  tabId: number | null;
  url: string;
  popups: string[];
}

/** A click that changed where the agent is or what is on top — what undo_click reverses. */
export interface ClickRecord {
  label: string;
  before: PageState;
  after: PageState;
}

export async function pageState(ctx: ToolContext): Promise<PageState> {
  const tab = await ctx.browser.currentTab().catch(() => null);
  const res = await ctx.browser.send({ kind: 'dialogs', waitMs: 0 }).catch(() => null);
  return { tabId: tab?.id ?? null, url: tab?.url ?? '', popups: (res?.dialogs ?? []).map((d) => d.title) };
}

/** Did the click open something (a tab, a page, a pop-up) that can be undone? */
export function changedSomething(c: ClickRecord): boolean {
  return c.after.tabId !== c.before.tabId || c.after.url !== c.before.url || c.after.popups.some((p) => !c.before.popups.includes(p));
}

/** The tool that takes the agent back from a wrong click. `onUndone` gets what was undone, for the user. */
export function undoTool(last: () => ClickRecord | null, onUndone: (note: string) => void): AgentTool<{ why?: string }> {
  return {
    name: 'undo_click',
    description:
      'Go back from your last click when it opened the wrong thing — a different tab, page or pop-up than you meant (for example an icon instead of the record’s name). It closes the tab it opened, goes back from the page, or closes the pop-up, and tells the user. Then do the right thing. It cannot undo something saved or sent.',
    schema: z.object({ why: z.string().optional().describe('What went wrong, in a few words, e.g. "opened Book appointment instead of the patient"') }),
    risk: 'action',
    touchesPage: true,
    label: () => `Going back from a wrong click${last() ? ` (${last()!.label.replace(/^Clicking /, '')})` : ''}`,
    async execute(a, ctx) {
      const c = last();
      if (!c) return { output: 'Nothing to undo: your last click did not open a tab, a page or a pop-up.', note: 'Nothing to undo' };
      const done: string[] = [];
      if (c.after.tabId !== null && c.after.tabId !== c.before.tabId) {
        await ctx.browser.closeTab(c.after.tabId).catch(() => undefined);
        if (c.before.tabId !== null) await ctx.browser.switchTab(c.before.tabId).catch(() => undefined);
        done.push('it opened a new tab — I closed it');
      } else if (c.after.url !== c.before.url) {
        await ctx.browser.history('back', ctx.signal);
        done.push('it opened another page — I went back');
      } else {
        const opened = c.after.popups.filter((p) => !c.before.popups.includes(p));
        const now = (await ctx.browser.send({ kind: 'dialogs', waitMs: 0 }).catch(() => null))?.dialogs ?? [];
        for (const title of opened) {
          const d = now.find((x) => x.title === title);
          if (!d) continue;
          if (d.close) await ctx.browser.send({ kind: 'click', id: d.close.id, highlight: false, double: false }).catch(() => undefined);
          else await ctx.browser.send({ kind: 'key', key: 'Escape' }).catch(() => undefined);
          done.push(`it opened the “${title}” pop-up — I closed it`);
        }
      }
      if (!done.length) return { output: 'Nothing to undo: what your last click opened is no longer there.', note: 'Nothing to undo' };
      onUndone(`I clicked ${c.label.replace(/^Clicking /, '')} by mistake (${done.join('; ')})${a.why ? ` — ${a.why}` : ''}.`);
      return { output: `Undone: ${done.join('; ')}. You are back where you were before that click — read the page, then do the right thing.`, note: 'Wrong click undone' };
    },
  };
}
