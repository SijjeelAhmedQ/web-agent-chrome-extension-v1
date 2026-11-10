import { z } from 'zod';
import { PageError } from '@/extension/browser/controller';
import { toolMeta } from '@/shared/constants/tools';
import { clip, siteOf, sleep } from '@/shared/utils';
import { classifyClick, classifySubmit, classifyTyping } from '../execution/riskPolicy';
import { formatDialogs, formatElement, formatSnapshot } from './format';
import { memoOf, pageDiff } from './pageDiff';
import { statusSummary } from './recordStatus';
import type { TextResult } from '@/extension/messaging/protocol';
import type { FormAround, TableResult, VisualRow } from '@/shared/types/page';
import type { AgentTool, ApprovalRequest, ToolContext, ToolOutcome } from './types';

/**
 * The generic browser tools. Nothing here knows about any particular website: every tool
 * works from the page-understanding layer's element ids and plain DOM semantics.
 */

const id = z.coerce.number().int().positive().describe('Element id from the latest read');
const bool = (fallback: boolean) =>
  z.preprocess((v) => (typeof v === 'string' ? v.toLowerCase() === 'true' : v), z.boolean().optional().default(fallback));

/** Required text the model may send as a number. (z.coerce.string turns a missing value into "undefined", so it would never be required.) */
const str = (schema = z.string()) => z.preprocess((v) => (typeof v === 'number' || typeof v === 'boolean' ? String(v) : v), schema);

const quote = (s: string) => `“${clip(s, 40)}”`;

function nameOf(ctx: ToolContext, elementId: number, fallback = 'the element'): string {
  const e = ctx.elements.get(elementId);
  if (e?.name) return quote(e.name);
  if (e?.context && fallback === 'the element') return `an unlabeled ${e.role === 'clickable' ? 'element' : e.role} in ${e.context}`;
  return fallback;
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

/** Lenient: every word of one name appears in the other (“Arya STARK” ~ “STARK, Arya”). */
function sameName(expected: string, actual: string): boolean {
  const a = norm(expected).split(' ').filter(Boolean);
  const b = norm(actual).split(' ').filter(Boolean);
  if (!a.length) return true;
  if (!b.length) return false;
  return a.every((w) => b.includes(w)) || b.filter((w) => w !== 'icon').every((w) => a.includes(w));
}

/** The element's name, when this site has buttons the agent must never click and it is one of them. */
async function neverClickName(ctx: ToolContext, elementId: number): Promise<string | null> {
  const list = (ctx.neverClick ?? []).map(norm).filter(Boolean);
  if (!list.length) return null;
  const info = await ctx.browser.send({ kind: 'describe', id: elementId }).catch(() => null);
  const name = info?.name ?? ctx.elements.get(elementId)?.name ?? '';
  return name && list.includes(norm(name)) ? name : null;
}

const neverClickOutcome = (name: string): ToolOutcome => ({
  output: `Not clicked: “${name}” is on this site’s never-click list — the user clicks it themselves. Do not try to press it another way. Stop and tell the user what is ready for them.`,
  note: `“${clip(name, 30)}” is for you to click`,
});

/** A model that mixes up ids (common with small models) clicks the wrong row or icon: stop that. */
function wrongTarget(ctx: ToolContext, elementId: number, expected: string): string | null {
  const known = ctx.elements.get(elementId);
  if (!expected.trim() || !known || sameName(expected, known.name)) return null;
  const what = known.name ? `${known.role} “${clip(known.name, 50)}”` : `an unlabeled ${known.role === 'clickable' ? 'element' : known.role}`;
  const others = ctx.elements
    .named(expected, sameName)
    .slice(0, 5)
    .map((e) => `[${e.id}] ${e.role} “${clip(e.name, 50)}”${e.context ? ` in ${e.context}` : ''}`);
  return `Not clicked: [${elementId}] is ${what}${known.context ? ` in ${known.context}` : ''}, not “${clip(expected, 50)}”. ${
    others.length ? `Elements with that name: ${others.join('; ')}. Click the right id.` : 'Use find_element or read_page to find it.'
  }`;
}

function isSecretField(ctx: ToolContext, elementId: number): boolean {
  const e = ctx.elements.get(elementId);
  return e?.type === 'password' || /password|passcode|\bpin\b|cvv|cvc|security code/i.test(e?.name ?? '');
}

async function pageUrl(ctx: ToolContext): Promise<string> {
  return (await ctx.browser.currentTab()).url ?? '';
}

function changeReport(after: { navigated: boolean; url: string; title: string; alerts?: string[] }): string {
  const alerts = after.alerts?.length ? ` Messages now on the page: ${after.alerts.map((a) => `“${clip(a, 160)}”`).join('; ')}.` : '';
  if (after.navigated) return ` The page changed — now “${after.title || 'untitled'}” (${clip(after.url, 120)}). Call read_page before acting on it.${alerts}`;
  return ` The page may have updated; call read_page if you need to see the result.${alerts}`;
}

function invalidReport(fields: string[] | undefined): string {
  return fields?.length ? ` The form was NOT submitted — the browser blocked it because: ${fields.join('; ')}. Fill these in, then submit again.` : '';
}

async function approvalFor(
  ctx: ToolContext,
  elementId: number,
  kind: 'click' | 'submit' | 'type',
  action: string,
  typed?: string,
): Promise<ApprovalRequest | null> {
  let info;
  try {
    info = await ctx.browser.send({ kind: 'describe', id: elementId });
  } catch {
    return null; // the action itself will report the problem
  }
  let verdict = kind === 'click' ? classifyClick(info) : kind === 'submit' ? classifySubmit(info) : classifyTyping(info);
  // A control this site's setup lists as changing a record the moment it is clicked or typed into (a tick box
  // or a comment box that saves itself).
  if (!verdict.consequential && kind !== 'submit' && (ctx.askBefore ?? []).map(norm).includes(norm(info.name ?? ''))) {
    verdict = { consequential: true, consequence: kind === 'type' ? 'change the record as you type (this site asks before typing here)' : 'change the record right away' };
    if (kind === 'type' && typed !== undefined) action = `Type “${typed}” into “${info.name}”?`;
  }
  // A button of a pop-up this site leaves to the user (an NZF interaction, “already in the active medicines list”):
  // the user's answer — on a card, unless this message of theirs names the button (“OK”).
  if (!verdict.consequential && kind === 'click' && userDecides(ctx, info)) {
    verdict = { consequential: true, consequence: 'answer a pop-up this site leaves to you' };
  }
  if (!verdict.consequential) return null;
  const site = siteOf(await pageUrl(ctx)) || 'this site';
  // A pop-up form with its own finishing buttons (Complete · Save · Reset · Cancel): the user picks one.
  const choices = kind !== 'type' && (info.formActions?.length ?? 0) >= 2 ? info.formActions!.map((b) => ({ id: b.id, label: b.name })) : undefined;
  return {
    // A row's action (Delete, Complete…): say which row — the record it changes.
    // Not a form's own Save that sits in a layout table: its “row” is the form's buttons, not a record.
    title: choices
      ? `Which should I press: ${choices.map((c) => `“${c.label}”`).join(', ')}?`
      : /^row \d+ “/.test(info.context ?? '') && !/^(save|submit|ok|done|add|update|confirm|apply|cancel)\b/i.test(info.name ?? '')
        ? `${action.replace(/\?$/, '')} — ${info.context}?`
        : action,
    detail: choices
      ? `The form is filled${info.formValues?.length ? ' — check the details' : ''}. “${info.name}” will ${verdict.consequence} on ${site}; pick what to do.`
      : `${popupSays(info)}This will ${verdict.consequence} on ${site}.${kind !== 'type' && info.formValues?.length ? ' Check the details:' : ''}`,
    confirmLabel: kind === 'type' ? 'Allow' : 'Confirm',
    ...(kind !== 'type' && info.formValues?.length ? { fields: info.formValues } : {}),
    ...(choices ? { choices, target: elementId } : {}),
  };
}

/** A button of a pop-up the site leaves to the user, not named in the user's message. */
function userDecides(ctx: ToolContext, info: { name?: string; context?: string; dialogText?: string }): boolean {
  const popups = (ctx.askPopups ?? []).map(norm).filter(Boolean);
  // Only a control inside a pop-up (dialogText: the pop-up's own text, Bootstrap and jQuery UI ones included).
  if (!popups.length || !info.dialogText) return false;
  const shown = norm(`${info.context ?? ''} ${info.dialogText}`);
  if (!popups.some((p) => shown.includes(p))) return false;
  const name = norm(info.name ?? '');
  const said = ` ${norm(ctx.userSaid ?? '')} `;
  return !(name && said.includes(` ${name} `));
}

/** A pop-up's Yes/OK: what the pop-up asks, so the user knows what the yes is to. */
function popupSays(info: { name: string; dialogText?: string }): string {
  if (!info.dialogText || !/^(yes|ok|okay|confirm|continue|proceed)\b/i.test(info.name.trim())) return '';
  const text = info.dialogText.replace(/^[×✕✖]\s*/, '').replace(/\s*\b(Yes|No|OK|Cancel)\b(\s+\b(Yes|No|OK|Cancel)\b)*\s*$/, '').trim();
  return text ? `The pop-up says: “${text}” ` : '';
}

/** Controls a page overview lists at most. */
const OVERVIEW_ELEMENTS = 100;

const readPage: AgentTool<{ mode: 'overview' | 'content'; full: boolean }> = {
  name: 'read_page',
  description:
    'Read the page: its controls as `[id] role "name"` and its visible text. mode "content": the full text, to read or summarise. Ids from an older page are invalid.',
  schema: z.object({
    mode: z.enum(['overview', 'content']).optional().default('overview').describe('"overview" (default) or "content"'),
    full: bool(false).describe('The whole page, not only what changed'),
  }),
  risk: 'read',
  touchesPage: true,
  label: (a) => (a.mode === 'content' ? 'Reading the page content' : 'Reading the page'),
  async execute(a, ctx) {
    const maxTextChars = a.mode === 'overview' && ctx.overviewTextChars ? Math.min(ctx.settings.maxTextChars, ctx.overviewTextChars) : ctx.settings.maxTextChars;
    // An overview lists the controls a step needs — those in a pop-up in front, new ones, then those on screen —
    // not every one on a big page (Indici's dashboard: 182, 5,000 tokens with every call after). The rest:
    // find_element, or mode "content".
    const maxElements = a.mode === 'overview' ? Math.min(ctx.settings.maxElements, OVERVIEW_ELEMENTS) : ctx.settings.maxElements;
    const snap = await ctx.browser.send({ kind: 'snapshot', mode: a.mode, maxElements, maxTextChars });
    // A pop-up whose content comes from another site (a formulary in a frame): read that frame too.
    const front = snap.dialogs?.[0];
    if (front?.frames?.length) {
      const inside = await ctx.browser.frameTexts(front.frames).catch(() => []);
      if (inside.length) front.fullText = [front.fullText ?? '', ...inside.map((f) => f.text)].filter(Boolean).join('\n').slice(0, 5000);
    }
    if (front?.pdfs?.length) front.fullText = [front.fullText ?? '', await pdfsText(ctx, front.pdfs)].filter(Boolean).join('\n').slice(0, 14_000);
    ctx.elements.remember([...snap.elements, ...(snap.dialogs ?? []).flatMap((d) => (d.close ? [d.close] : []))], true);
    const n = snap.elements.length + snap.omitted;
    // The same page read again: only what changed — when that is clearly shorter than the whole page.
    const whole = formatSnapshot(snap, a.mode);
    const changes = a.mode === 'overview' && !a.full && ctx.lastPage ? pageDiff(ctx.lastPage, snap) : null;
    // Each “only the changes” read stands on the ones before it, so none of them can be dropped to fit. On a
    // small context, once they add up, a whole read starts a new chain and the old one can go.
    const chainRoom = ctx.overviewTextChars ? 6_000 : 40_000;
    const diff = changes !== null && changes.length < whole.length * 0.6 && (ctx.diffChars ?? 0) + changes.length <= chainRoom;
    ctx.diffChars = diff ? (ctx.diffChars ?? 0) + changes.length : 0;
    ctx.lastPage = memoOf(snap);
    return { output: diff ? changes : whole, note: `${n} controls · ${clip(snap.title || siteOf(snap.url), 40)}${diff ? ' · only the changes' : ''}` };
  },
};

const findElement: AgentTool<{ query: string }> = {
  name: 'find_element',
  description: 'Find controls by a description ("search box", "Add button") and matching text — for those a read left out.',
  schema: z.object({ query: z.string().min(1).describe('What to look for') }),
  risk: 'read',
  touchesPage: true,
  label: (a) => `Looking for ${quote(a.query)}`,
  async execute(a, ctx) {
    const res = await ctx.browser.send({ kind: 'find', query: a.query, limit: 10 });
    ctx.elements.remember(res.matches);
    if (!res.matches.length && !res.textMatches.length) {
      return { output: `Nothing matching "${a.query}" found. Try other words, scroll, or read_page.`, note: 'Not found' };
    }
    const lines = res.matches.map(formatElement);
    if (res.textMatches.length) {
      lines.push('', 'Matching text on the page:', ...res.textMatches.map((t) => `- ${t}`));
      if (!res.matches.some((m) => sameName(a.query, m.name))) lines.push(`No control is named “${a.query}” — if that text is what you want to click, use click_text.`);
    }
    return { output: lines.join('\n'), note: res.matches[0] ? `Found ${quote(res.matches[0].name || res.matches[0].role)}` : 'Found matching text' };
  },
};

/** Clicks a known element id and reports what happened. Shared by click and click_text. */
async function clickById(ctx: ToolContext, elementId: number, double = false): Promise<ToolOutcome> {
  // A dropdown, known before the click changes it: clicking it and then its option is two steps where one does.
  const list = await ctx.browser.send({ kind: 'describe', id: elementId }).then((d) => (d?.opensList ? d.name : null), () => null);
  const tabs = await ctx.browser.watchNewTabs();
  try {
    const outcome = await clickAndReport(ctx, elementId, double, tabs.opened);
    return list === null ? outcome : { ...outcome, output: `${outcome.output}\n${dropdownHint(list, elementId)}` };
  } finally {
    tabs.stop();
  }
}

/** What a click on a dropdown is told: choose in it with select_option. */
export const dropdownHint = (name: string, id: number) =>
  `${name ? quote(name) : 'This'} is a dropdown: choose in it with select_option (id ${id} and the option's text) — one step, not a click on the dropdown and another on its option.`;

/** The page opened a new tab or pop-up window: work there. */
/**
 * After a new page or tab: a dialog that pops up over it (often a moment later) is named right
 * away, so the model deals with it even if it skips reading the page.
 */
async function dialogReport(ctx: ToolContext): Promise<string> {
  const res = await ctx.browser.send({ kind: 'dialogs', waitMs: 2500 }).catch(() => null);
  // These — and only these — are the pop-ups that came with the page opening.
  ctx.arrivalPopups = new Set((res?.dialogs ?? []).map((d) => d.title));
  ctx.arrivalOpen = true;
  if (!res?.dialogs.length) return '';
  ctx.elements.remember(res.dialogs.flatMap((d) => (d.close ? [d.close] : [])));
  return ` A dialog is showing on top of the page — it came up as the page opened.\n${formatDialogs(res.dialogs)}\nDeal with it first — read_page shows its fields and buttons — following any rule you were given for pop-ups that come up when this page opens.`;
}

async function followNewTab(ctx: ToolContext, tab: chrome.tabs.Tab, label: string, how = ''): Promise<ToolOutcome> {
  const now = await ctx.browser.adoptTab(tab, ctx.signal);
  const dialog = await dialogReport(ctx);
  return {
    output: `Clicked ${label}${how}. It opened “${now.title || 'a page'}” (${clip(now.url ?? '', 120)}) in a new tab or window — you are now working there. Call read_page.${dialog}`,
    note: dialog ? 'Opened in a new tab · a dialog is showing' : 'Opened in a new tab',
  };
}

/** A control that says it opens something: a tab it opens can take its time. */
export const saysOpen = (name: string) => /^open\b/i.test(name.trim());

/** How long a click whose only effect is a small change gets to open a tab, in milliseconds. */
export function tabPatience(name: string, added: string[]): number {
  const own = name.trim().toLowerCase();
  return saysOpen(name) && added.length > 0 && added.every((l) => l.trim().toLowerCase() === own) ? 12_000 : 2_500;
}

async function clickAndReport(ctx: ToolContext, elementId: number, double: boolean, openedTab: () => chrome.tabs.Tab | null): Promise<ToolOutcome> {
  const before = await pageUrl(ctx);
  let res;
  try {
    res = await ctx.browser.send({ kind: 'click', id: elementId, highlight: ctx.settings.highlightActions, double });
  } catch (err) {
    if (err instanceof PageError && err.code === 'navigating') {
      const after = await ctx.browser.settleAfterAction(before, ctx.signal);
      return { output: `Clicked.${changeReport({ ...after, navigated: true })}`, note: 'Opened a new page' };
    }
    throw err;
  }
  const label = res.element.name ? quote(res.element.name) : 'the element';
  if (res.menu?.length) {
    ctx.elements.remember(res.menu);
    return {
      output: `${label} opens a menu on hover, so I opened the menu instead of clicking. Items now showing:\n${res.menu.map(formatElement).join('\n')}\nClick the item you want. (Click ${label} again only if you want its own page.)`,
      note: `Opened its menu · ${res.menu.length} items`,
    };
  }
  if (res.opensNewTab) {
    const tab = await ctx.browser.openTab(res.opensNewTab, ctx.signal);
    const dialog = await dialogReport(ctx);
    return {
      output: `${label} opens in a new tab, so I opened it: “${tab.title}” (${clip(tab.url ?? '', 120)}). You are now working in that tab. Call read_page.${dialog}`,
      note: dialog ? 'Opened in a new tab · a dialog is showing' : 'Opened in a new tab',
    };
  }
  let after = await ctx.browser.settleAfterAction(before, ctx.signal);
  const covered = res.covered ? ' Note: something was covering it (a pop-up or banner?) — check the result.' : '';
  if (res.invalidFields) return { output: `Clicked ${label}.${invalidReport(res.invalidFields)}`, note: 'Form has missing or invalid fields' };
  const verb = double ? 'Double-clicked' : 'Clicked';
  let effect = after.navigated ? undefined : after.effect;
  const changed = () => after.navigated || !!effect?.added.length || !!effect?.removed || after.alerts.length > 0;

  // Older apps answer slowly (a round trip to the server): give them a few seconds before
  // deciding nothing happened — a new tab or window, a page load, or new content.
  for (let waited = 0; !changed() && !openedTab() && waited < 3000; waited += 400) {
    await sleep(400);
    const tab = await ctx.browser.currentTab();
    if (tab.status === 'loading' || (tab.url ?? '') !== before) {
      await ctx.browser.waitForLoad(tab.id!, 20_000, ctx.signal);
      const loaded = await ctx.browser.currentTab();
      after = { navigated: true, url: loaded.url ?? '', title: loaded.title ?? '', alerts: [] };
      break;
    }
    effect = (await ctx.browser.send({ kind: 'effect' }).catch(() => undefined)) ?? effect;
  }
  // A tab that opens a moment after a small change — a tooltip showed (Indici's “Open AI Assisted Inbox” icon) — is
  // waited for too: else the agent stays on the page it left and has to find the tab itself (three calls).
  if (!openedTab() && !after.navigated && changed() && (effect?.added.length ?? 0) <= 2 && !effect?.removed) {
    // “Open …” with only its own tooltip showing has done nothing yet: the Smart AI Inbox's tab took up to eleven seconds.
    const patience = tabPatience(res.element.name ?? '', effect?.added ?? []);
    for (let waited = 0; !openedTab() && waited < patience; waited += 300) await sleep(300);
  }
  // “Open …” that changed nothing, or only its look: its tab may still come. None by then: the click didn't take (Indici's
  // “Open AI Assisted Inbox” at times only selects on the first), so once more — or the model looks for the tab, waits and
  // finds the icon again (five calls) to do just this.
  if (!openedTab() && !changed() && saysOpen(res.element.name ?? '')) {
    const tabIn = async (ms: number) => {
      for (let waited = 0; !openedTab() && waited < ms; waited += 300) await sleep(300);
    };
    await tabIn(12_000);
    if (!openedTab()) {
      await ctx.browser.send({ kind: 'click', id: elementId, highlight: false, double }).catch(() => null);
      after = await ctx.browser.settleAfterAction(before, ctx.signal);
      effect = after.navigated ? undefined : after.effect;
      if (!changed()) await tabIn(12_000);
    }
  }
  const tab = openedTab();
  if (tab) return followNewTab(ctx, tab, label);

  // Links, names and menu items open things; a button such as Clear or Search may rightly
  // change nothing — no real click (and no debugger bar) for those.
  const opener = /^(link|clickable|menuitem|option|tab|gridcell|row|cell|image|treeitem)$/.test(res.element.role ?? '');
  if (!changed() && opener && ctx.settings.realClicks !== false) {
    // Some pages ignore script clicks, or open the record in a pop-up only a real click may open.
    const real = await realClick(ctx, elementId, label, double, openedTab).catch(() => null);
    if (real) return real;
  }
  // A pop-up that waits on the server (“Processing…”, then Indici's Medication Advanced Search) can show after the
  // seconds above: one more look before saying nothing changed — or the model presses it again and reads twice.
  if (!changed() && effect) {
    await ctx.browser.send({ kind: 'settle', quietMs: 1_200, timeoutMs: 4_000 }).catch(() => null);
    effect = (await ctx.browser.send({ kind: 'effect' }).catch(() => undefined)) ?? effect;
    const late = openedTab();
    if (late) return followNewTab(ctx, late, label);
  }
  // A form's Save that changed nothing, its pop-up still open: it was refused — not “fine”. Say which
  // required fields are still empty, or the model goes on as if it had saved (and presses Complete).
  if (!changed() && effect && /^(save|submit|ok|done|add|update|confirm|apply)\b/i.test(res.element.name ?? '')) {
    const shown = await ctx.browser.send({ kind: 'dialogs', waitMs: 300, settle: false }).catch(() => null);
    const form = shown?.dialogs[0]?.form ?? [];
    let missing = form.filter((l) => /^- [^—]*\*\s—/.test(l) && /:\s*empty\b|none chosen/.test(l)).map((l) => l.replace(/^- /, '').replace(/\s—.*$/, ''));
    // A form laid out in the page (not a pop-up): its own fields, and the ones the page marked as wrong.
    const around = await ctx.browser.send({ kind: 'formAround', id: elementId }).catch(() => null);
    if (around) missing = [...new Set([...missing, ...around.missing])];
    const flagged = around?.flagged ?? [];
    if (form.length || around) {
      const what = [missing.length ? ` Required fields still empty: ${missing.join(', ')}.` : '', flagged.length ? ` Fields the page marks as wrong: ${flagged.join(', ')}.` : ''].join('');
      return {
        output: `${verb} ${label}, but the form is still there and nothing changed — it was NOT saved.${what ? `${what} Fill them (a field with suggestions needs one of them clicked), then press ${label} again.` : ' Read the page: look for a message or a required field that is not set, fix it, then press it again.'} Don't press any other of the form's buttons instead, and don't count this as done.`,
        note: 'Not saved — the form is still there',
      };
    }
  }
  // A Save that did change the page — a message, a field turned red — with its pop-up still there and a
  // required field still empty or marked wrong: refused too (a saved pop-up closes).
  if (changed() && !after.navigated && /^(save|submit|ok|done|add|update|confirm|apply)\b/i.test(res.element.name ?? '')) {
    const around = await ctx.browser.send({ kind: 'formAround', id: elementId }).catch(() => null);
    if (around?.popup && (around.missing.length || around.flagged.length)) {
      const said = effect?.added.length ? ` The page says: ${effect.added.map((l) => `“${clip(l, 80)}”`).join(', ')}.` : '';
      const what = [around.missing.length ? ` Required fields still empty: ${around.missing.join(', ')}.` : '', around.flagged.length ? ` Fields the page marks as wrong: ${around.flagged.join(', ')}.` : ''].join('');
      return {
        output: `${verb} ${label}, but its pop-up is still open — it was most likely NOT saved.${said}${what} Fix them (a field with suggestions needs one of them clicked), then press ${label} again. Don't press any other of the form's buttons instead, and don't count this as done.`,
        note: 'Not saved — the form is still open',
      };
    }
  }
  if (!changed() && effect && !opener) {
    return { output: `${verb} ${label}. Nothing on the page changed — fine if there was nothing to do (e.g. the fields were already empty). Don’t click it again; carry on with the next step.${covered}`, note: 'Nothing changed' };
  }
  if (!changed() && effect) {
    // Saying so stops the model from clicking again, or clicking around to find out.
    const tried = ctx.settings.realClicks !== false ? ' (a real mouse click was tried too)' : '';
    const advice = ' Do not click it again or try other buttons and icons to find out. Call read_page once to check; if what you expected is not there, tell the user what you clicked and what happened.';
    return effect.styleChanges
      ? { output: `${verb} ${label}${tried}. Only its look changed (it may be selected or highlighted now) — nothing new appeared in this tab within a few seconds.${advice}${covered}`, note: 'Selected — nothing opened', noEffect: true }
      : { output: `${verb} ${label}${tried}, but nothing on the page changed within a few seconds.${advice}${covered}`, note: 'Nothing changed', noEffect: true };
  }
  const appeared = effect?.added.length ? ` New on the page: ${effect.added.map((l) => `“${clip(l, 80)}”`).join(', ')}.` : '';
  const dialog = after.navigated ? await dialogReport(ctx) : '';
  return {
    output: `${verb} ${label}.${appeared}${changeReport(after)}${dialog}${covered}`,
    note: after.navigated ? (dialog ? 'Opened a new page · a dialog is showing' : 'Opened a new page') : effect?.added.length ? 'The page changed' : undefined,
  };
}

const double = bool(false).describe('Only when the user says the app needs a double-click');

/** Clicks again with real mouse input. Returns null when that changed nothing either. */
async function realClick(ctx: ToolContext, elementId: number, label: string, double: boolean, openedTab: () => chrome.tabs.Tab | null): Promise<ToolOutcome | null> {
  const before = await pageUrl(ctx);
  const point = await ctx.browser.send({ kind: 'pointAt', id: elementId });
  const opened = (await ctx.browser.realClick(point.x, point.y, double)) ?? openedTab();
  if (opened) return followNewTab(ctx, opened, label, ' (real mouse click)');
  const after = await ctx.browser.settleAfterAction(before, ctx.signal);
  const effect = after.navigated ? undefined : after.effect;
  if (!after.navigated && !effect?.added.length && !effect?.removed && !after.alerts.length) return null;
  const appeared = effect?.added.length ? ` New on the page: ${effect.added.map((l) => `“${clip(l, 80)}”`).join(', ')}.` : '';
  return {
    output: `Clicked ${label} (a normal click did nothing, so I used a real mouse click).${appeared}${changeReport(after)}`,
    note: after.navigated ? 'Opened a new page' : 'The page changed',
  };
}

const click: AgentTool<{ id: number; name: string; double: boolean }> = {
  name: 'click',
  description:
    'Click a control (button, link, tab, checkbox, row…); waits for the page. Pass its name as listed: a different id is refused.',
  schema: z.object({
    id,
    name: z.coerce.string().optional().default('').describe('Its name as listed'),
    double,
  }),
  risk: 'sensitive',
  touchesPage: true,
  label: (a, ctx) => `${a.double ? 'Double-clicking' : 'Clicking'} ${nameOf(ctx, a.id)}`,
  async assess(a, ctx) {
    // A never-click button is refused, not offered for approval — and so is an id that is another element than
    // the one named (a guessed id that is “Send Text”, for “Medications”): the user is never asked about it.
    if (await neverClickName(ctx, a.id)) return null;
    if (wrongTarget(ctx, a.id, a.name)) return null;
    return approvalFor(ctx, a.id, 'click', `Click ${nameOf(ctx, a.id, 'this')}?`);
  },
  async execute(a, ctx) {
    const mismatch = wrongTarget(ctx, a.id, a.name);
    if (mismatch) return { output: mismatch, note: 'Wrong element — not clicked' };
    const never = await neverClickName(ctx, a.id);
    if (never) return neverClickOutcome(never);
    return clickById(ctx, a.id, a.double);
  },
};

interface ClickTextArgs {
  text: string;
  near: string;
  double: boolean;
}

/** The page is searched once per call (approval check and click share it). */
const textTargets = new WeakMap<ClickTextArgs, TextResult>();

/** click_text with words to enter (“follow up”): it only clicks — say which field to type them into. */
function typeHint(ctx: ToolContext, text: string): string {
  const fields = ctx.elements.onPage().filter((e) => ['textbox', 'searchbox', 'combobox'].includes(e.role) && !e.value);
  const field = fields.find((e) => e.inBlockingPopup || /^dialog/.test(e.context ?? '')) ?? (fields.length === 1 ? fields[0] : undefined);
  return `
click_text only clicks — it never types. If “${text}” is text to enter, call type with the field's id${field ? `: [${field.id}] ${field.role} “${field.name}”` : ''}, then click the button that saves it.`;
}

async function textTarget(a: ClickTextArgs, ctx: ToolContext): Promise<TextResult> {
  let res = textTargets.get(a);
  // An element's id sent as its text (“8400”, “[8400]”): the model means that element.
  const asId = a.text.trim().match(/^\[?(\d{3,6})\]?$/);
  const known = asId ? ctx.elements.get(Number(asId[1])) : undefined;
  if (!res && known) {
    res = { matches: [{ tag: '', inViewport: true, ...known }], total: 1 };
    textTargets.set(a, res);
  }
  if (!res) {
    res = await ctx.browser.send({ kind: 'findText', text: a.text, near: a.near || undefined, limit: 6 });
    ctx.elements.remember(res.matches);
    textTargets.set(a, res);
  }
  return res;
}

const clickText: AgentTool<ClickTextArgs> = {
  name: 'click_text',
  description:
    'Click visible text that is not a listed control (a name in a table, a search suggestion). Appears more than once: pass near, other text of its row. Never types.',
  schema: z.object({
    text: str(z.string().min(1)).describe('The text, e.g. "Arya STARK"'),
    near: z.coerce.string().optional().default('').describe('Other text of its row (a date, an ID)'),
    double,
  }),
  risk: 'sensitive',
  touchesPage: true,
  label: (a) => `${a.double ? 'Double-clicking' : 'Clicking'} ${quote(a.text)}${a.near ? ` (with ${quote(a.near)})` : ''}`,
  async assess(a, ctx) {
    const res = await textTarget(a, ctx);
    if (res.total !== 1 || (await neverClickName(ctx, res.matches[0].id))) return null;
    return approvalFor(ctx, res.matches[0].id, 'click', `Click ${quote(a.text)}?`);
  },
  async execute(a, ctx) {
    const res = await textTarget(a, ctx);
    textTargets.delete(a);
    if (!res.total) {
      return {
        output: `No visible text or control named “${a.text}”${a.near ? ` near “${a.near}”` : ''} on the page. Don’t retry click_text with other wording — call find_element (e.g. "${a.text} button") or read_page, then click the element by its id. If it is not there, scroll, search or go to the next page of results.${typeHint(ctx, a.text)}`,
        note: 'Text not found',
      };
    }
    if (res.total > 1) {
      return {
        output: `“${a.text}” appears ${res.total} times:\n${res.matches.map(formatElement).join('\n')}\nIf the user said which one (a date of birth, an ID), call click_text again with near (that text from the right row), or click its id. If the user didn't say, don't choose: ask the user which one, listing them.`,
        note: `${res.total} matches — not clicked`,
      };
    }
    const never = await neverClickName(ctx, res.matches[0].id);
    if (never) return neverClickOutcome(never);
    return clickById(ctx, res.matches[0].id, a.double);
  },
};

/**
 * Adding words to a field that already ends with them, or holds them (a comment added on a record before): its
 * text, so the words aren't written twice. Only for adding (clear false) and real words, not a letter or a digit.
 */
async function holdsAlready(ctx: ToolContext, a: { id: number; text: string; clear: boolean }): Promise<string | null> {
  const words = a.text.replace(/\s+/g, ' ').trim().toLowerCase();
  if (a.clear || words.length < 4 || isSecretField(ctx, a.id)) return null;
  const now = await ctx.browser.send({ kind: 'fieldText', id: a.id }).then((r) => r.value, () => '');
  return now && now.toLowerCase().includes(words) ? now : null;
}

/** A form's filled fields around a field, to tell what else filling it changed. */
async function formAroundOf(ctx: ToolContext, id: number): Promise<FormAround | null> {
  return ctx.browser.send({ kind: 'formAround', id }).catch(() => null);
}

/**
 * Other fields the page itself rewrote when this one was set — Indici writes the Directions anew when
 * the Frequency is chosen, over what the agent had typed there. Said, so what the user gave is set again.
 */
async function otherChanges(ctx: ToolContext, id: number, before: FormAround | null): Promise<string> {
  if (!before) return '';
  await ctx.browser.send({ kind: 'settle', quietMs: 300, timeoutMs: 1500 }).catch(() => null);
  const after = await formAroundOf(ctx, id);
  if (!after) return '';
  const was = new Map(before.values.map((v) => [v.label, v.value]));
  const changed = after.values.filter((v) => v.label !== after.self && was.has(v.label) && was.get(v.label) !== v.value);
  if (!changed.length) return '';
  return ` The page also changed ${changed.map((v) => `“${v.label}” from ${quote(was.get(v.label)!)} to ${quote(v.value)}`).join(', ')}. If the user gave a value for it, set it again now.`;
}

const type: AgentTool<{ id: number; text: string; clear: boolean; submit: boolean; then_click?: number }> = {
  name: 'type',
  description:
    'Type into a text field, search box or editor; replaces its text unless clear is false. submit: Enter after; then_click: press that Search or Go button after — one step.',
  schema: z.object({
    id,
    text: str().describe('The text to type'),
    clear: bool(true).describe('Replace the text (default true)'),
    submit: bool(false).describe('Enter after typing'),
    then_click: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe('Id of a Search or Go button to press after (not Save, Send or Delete)'),
  }),
  risk: 'action',
  touchesPage: true,
  label: (a, ctx) => {
    const shown = isSecretField(ctx, a.id) ? '••••' : quote(a.text);
    const target = ctx.elements.get(a.id)?.name;
    return `Typing ${shown}${target ? ` into ${quote(target)}` : ''}${a.then_click ? `, then pressing ${nameOf(ctx, a.then_click, 'a button')}` : ''}`;
  },
  async assess(a, ctx) {
    if (await holdsAlready(ctx, a)) return null; // not typed (execute says so): nothing to approve
    const typing = await approvalFor(ctx, a.id, 'type', `Type into ${nameOf(ctx, a.id, 'this field')}?`, isSecretField(ctx, a.id) ? undefined : a.text);
    if (typing) return typing;
    return a.submit ? approvalFor(ctx, a.id, 'submit', 'Submit this form?') : null;
  },
  async execute(a, ctx) {
    const already = await holdsAlready(ctx, a);
    if (already) {
      return {
        output: `Not typed: ${nameOf(ctx, a.id, 'the field')} already holds “${a.text.trim()}” — it now reads ${quote(clip(already, 200))}. Adding it again would write it twice. Leave this one as it is and go on (to the next record, if you are going through several).`,
        note: 'Already there — not typed again',
      };
    }
    const before = await pageUrl(ctx);
    const form = a.submit || isSecretField(ctx, a.id) ? null : await formAroundOf(ctx, a.id);
    const trusted = ctx.settings.realClicks !== false;
    let res = await ctx.browser.send({ kind: 'type', id: a.id, text: a.text, clear: a.clear, highlight: ctx.settings.highlightActions, trusted });
    // A rich editor with its caret placed: the text goes in as real keyboard input (or, failing that, by script).
    if (res.awaitsInput) {
      const typed = await ctx.browser.realType(a.text).then(() => true, () => false);
      res = typed
        ? { ...res, value: clip((await ctx.browser.send({ kind: 'fieldText', id: a.id })).value, 200) }
        : await ctx.browser.send({ kind: 'type', id: a.id, text: a.text, clear: a.clear, highlight: false });
    }
    const label = res.element.name ? quote(res.element.name) : 'the field';
    if (res.dateNotTaken) {
      return {
        output: `${label} did not take ${quote(a.text)}: it put back ${quote(res.value)}. Type the date the way that one is written (the same order of day, month and year, and separators).`,
        note: "The date didn't take",
      };
    }
    let output = `Typed into ${label}. It now contains: ${quote(res.value)}.${await otherChanges(ctx, a.id, form)}`;
    if (res.suggestions?.length && !a.submit) {
      output += ` A list of suggestions opened under it: ${res.suggestions.map((s) => quote(s)).join(', ')}. Typing alone chose none of them — click the one you mean (click_text with its text), or the field stays unset.`;
    }
    if (a.submit) {
      try {
        const key = await ctx.browser.send({ kind: 'key', key: 'Enter', id: a.id });
        if (key.invalidFields) return { output: `${output} Pressed Enter.${invalidReport(key.invalidFields)}`, note: 'Form has missing or invalid fields' };
      } catch (err) {
        if (!(err instanceof PageError && err.code === 'navigating')) throw err;
      }
      const after = await ctx.browser.settleAfterAction(before, ctx.signal);
      output += ` Pressed Enter.${changeReport(after)}`;
      return { output, note: after.navigated ? 'Submitted' : undefined };
    }
    if (a.then_click) return { output: `${output}${await pressAfterTyping(ctx, a.then_click, !!res.suggestions?.length)}` };
    return { output };
  },
};

/**
 * type's then_click: the button pressed after typing, in the same step — a whole model call saved (typing a name,
 * then pressing Search). Only a button that needs no one's OK: one that saves, sends or deletes, one this site
 * never lets the agent click, or any when the agent asks before every action, is left for click (which asks).
 * Nor while a list of suggestions waits for a choice: the field isn't set yet.
 */
async function pressAfterTyping(ctx: ToolContext, buttonId: number, suggestions: boolean): Promise<string> {
  const name = nameOf(ctx, buttonId, `[${buttonId}]`);
  if (suggestions) return ` ${name} was not pressed: choose a suggestion first, then press it.`;
  if (ctx.askEveryAction || (await neverClickName(ctx, buttonId)) || (await approvalFor(ctx, buttonId, 'click', ''))) {
    return ` ${name} was not pressed: it needs the user's OK — press it with click.`;
  }
  const clicked = await clickById(ctx, buttonId);
  return ` Then: ${clicked.output}`;
}

const clear: AgentTool<{ id: number }> = {
  name: 'clear',
  description: 'Empty a text field.',
  schema: z.object({ id }),
  risk: 'action',
  touchesPage: true,
  label: (a, ctx) => `Clearing ${nameOf(ctx, a.id, 'the field')}`,
  async execute(a, ctx) {
    const res = await ctx.browser.send({ kind: 'clear', id: a.id, highlight: ctx.settings.highlightActions });
    return { output: `Cleared ${res.element.name ? quote(res.element.name) : 'the field'}.` };
  },
};

const selectOption: AgentTool<{ id: number; option: string }> = {
  name: 'select_option',
  description: 'Choose a dropdown\'s option by its text, in one step: it opens the dropdown, finds the option and clicks it (native and Ant Design). Another custom dropdown: click it, then the option.',
  schema: z.object({ id, option: str().describe('The option\'s text') }),
  risk: 'action',
  touchesPage: true,
  label: (a, ctx) => `Choosing ${quote(a.option)}${ctx.elements.get(a.id)?.name ? ` in ${nameOf(ctx, a.id)}` : ''}`,
  async execute(a, ctx) {
    const form = await formAroundOf(ctx, a.id);
    const res = await ctx.browser.send({ kind: 'select', id: a.id, option: a.option, highlight: ctx.settings.highlightActions });
    const also = form ? await otherChanges(ctx, a.id, form) : '';
    if (!form) await ctx.browser.send({ kind: 'settle', quietMs: 300, timeoutMs: 1500 }).catch(() => null);
    return { output: `Selected ${quote(res.selected)} in ${res.element.name ? quote(res.element.name) : 'the dropdown'}.${also}` };
  },
};

const scroll: AgentTool<{ direction?: 'up' | 'down' | 'top' | 'bottom'; id?: number }> = {
  name: 'scroll',
  description: 'Scroll a screen down or up, to the top or bottom, or to an element (id).',
  schema: z.object({
    direction: z.enum(['up', 'down', 'top', 'bottom']).optional().describe('Default "down"'),
    id: id.optional().describe('Scroll to this element'),
  }),
  risk: 'read',
  touchesPage: true,
  label: (a, ctx) => (a.id ? `Scrolling to ${nameOf(ctx, a.id)}` : `Scrolling ${a.direction === 'top' ? 'to the top' : a.direction === 'bottom' ? 'to the bottom' : a.direction ?? 'down'}`),
  async execute(a, ctx) {
    const res = await ctx.browser.send({ kind: 'scroll', direction: a.id ? undefined : a.direction ?? 'down', id: a.id });
    const where = res.atBottom ? 'at the bottom of the page' : res.atTop ? 'at the top of the page' : `${res.percent}% down the page`;
    return { output: `${res.moved ? 'Scrolled' : "Couldn't scroll further"} — now ${where}. Call read_page to see what is visible.` };
  },
};

const hover: AgentTool<{ id: number }> = {
  name: 'hover',
  description:
    'Hover over a control: opens hover menus and tooltips; returns what appeared, with ids.',
  schema: z.object({ id }),
  risk: 'read',
  touchesPage: true,
  label: (a, ctx) => `Hovering over ${nameOf(ctx, a.id)}`,
  async execute(a, ctx) {
    const res = await ctx.browser.send({ kind: 'hover', id: a.id, highlight: ctx.settings.highlightActions });
    ctx.elements.remember(res.revealed);
    const label = res.element.name ? quote(res.element.name) : 'the element';
    if (!res.revealed.length) {
      return { output: `Hovered over ${label}. Nothing new appeared — it may open on click instead, or it is already open. Call read_page to check.`, note: 'Nothing new appeared' };
    }
    return { output: `Hovered over ${label}. These appeared:\n${res.revealed.map(formatElement).join('\n')}`, note: `${res.revealed.length} items appeared` };
  },
};

const pathSchema = z.preprocess(
  (v) => (typeof v === 'string' ? v.split(/\s*(?:>|›|»|→|\/)\s*/).filter(Boolean) : v),
  z.array(z.string().min(1)).min(1).max(6),
);

const openMenu: AgentTool<{ path: string[] }> = {
  name: 'open_menu',
  description:
    'Open nested menus by their labels and choose the last item, e.g. ["Patients", "Search & List"] — one step. An item that saves, sends or deletes is not clicked: click it next. Only menu labels: returns the last level\'s items.',
  schema: z.object({ path: pathSchema.describe('Labels from the top down, the item last') }),
  risk: 'read',
  touchesPage: true,
  label: (a) => `Opening ${a.path.map((p) => quote(p)).join(' › ')}`,
  async execute(a, ctx) {
    const res = await ctx.browser.send({ kind: 'menuPath', path: a.path, highlight: ctx.settings.highlightActions });
    ctx.elements.remember([...res.revealed, ...(res.options ?? []), ...(res.item ? [res.item] : [])]);
    const trail = res.opened.length ? res.opened.map((p) => quote(p)).join(' › ') : 'nothing';
    // The last label is an item: chosen now, as the next step would do — a whole model call saved. Not one the
    // site never lets the agent click, nor one that would need the user's approval (a save, a send, a delete),
    // nor anything when the agent asks before every action: those are clicked with click, which asks.
    if (res.item && !ctx.askEveryAction && !(await neverClickName(ctx, res.item.id)) && !(await approvalFor(ctx, res.item.id, 'click', ''))) {
      const hadDialog = !!(await ctx.browser.send({ kind: 'dialogs', waitMs: 0, settle: false }).catch(() => null))?.dialogs.length;
      const clicked = await clickById(ctx, res.item.id);
      // The menu closing counts as a change, so the click doesn't wait for the form the item opens a moment later
      // (the Smart AI Inbox's Actions › Create Task): waited for here, the page that comes with this result has it —
      // or the model spends a wait and another read on it.
      if (!hadDialog && !/new (page|tab)/i.test(clicked.note ?? '')) await formAfterLoading(ctx);
      return { output: `Opened ${trail} and clicked ${quote(res.item.name || 'the last item')}. ${clicked.output}`, note: clicked.note ?? `Chose “${clip(res.item.name, 30)}”` };
    }
    if (res.item) {
      return {
        output: `Opened ${trail}. ${quote(res.item.name || 'The last label')} is an item, not a menu — it is showing now as:\n${formatElement(res.item)}\nClick it with click to choose it.`,
        note: `“${clip(res.item.name, 30)}” is showing`,
      };
    }
    if (res.failedAt) {
      const options = (res.options ?? []).map(formatElement).join('\n');
      return {
        output: `Opened ${trail}, but couldn't find ${quote(res.failedAt)} there. ${options ? `Items at that level:\n${options}` : 'No items were visible — try hover or click on the previous level.'}`,
        note: `“${clip(res.failedAt, 30)}” not found`,
      };
    }
    if (!res.revealed.length) {
      return { output: `Opened ${trail}, but no new items appeared. The menu may need a click, or it was already open — call read_page.`, note: 'Nothing new appeared' };
    }
    return { output: `Opened ${trail}. Items now showing:\n${res.revealed.map(formatElement).join('\n')}\nClick the one you want.`, note: `${res.revealed.length} items showing` };
  },
};

const LOADING = /^(loading|please wait|processing)\b/i;

/**
 * Waits for the pop-up a menu item opens — past one that only says it is loading (the Smart AI Inbox's
 * “Loading Task Data”, three seconds before “Add Task”).
 */
export async function formAfterLoading(ctx: ToolContext): Promise<void> {
  const deadline = Date.now() + 10_000;
  let shown = await ctx.browser.send({ kind: 'dialogs', waitMs: 3_000, settle: false }).catch(() => null);
  while (shown?.dialogs.some((d) => LOADING.test(d.title ?? '')) && Date.now() < deadline) {
    await sleep(400);
    shown = await ctx.browser.send({ kind: 'dialogs', waitMs: 0, settle: false }).catch(() => null);
  }
}

const pressKey: AgentTool<{ key: string; id?: number }> = {
  name: 'press_key',
  description: 'Press a key (Enter, Escape, Tab, arrows…) on a control or the focused one. Enter submits a form; Escape closes most pop-ups.',
  schema: z.object({ key: z.string().min(1), id: id.optional() }),
  risk: 'sensitive',
  touchesPage: true,
  label: (a) => `Pressing ${a.key}`,
  async assess(a, ctx) {
    if (!/^(enter|return)$/i.test(a.key) || !a.id) return null;
    return approvalFor(ctx, a.id, 'submit', 'Submit this form?');
  },
  async execute(a, ctx) {
    const before = await pageUrl(ctx);
    let submitted = false;
    let invalid: string[] | undefined;
    try {
      const res = await ctx.browser.send({ kind: 'key', key: a.key, id: a.id });
      submitted = res.submittedForm;
      invalid = res.invalidFields;
    } catch (err) {
      if (!(err instanceof PageError && err.code === 'navigating')) throw err;
    }
    if (invalid) return { output: `Pressed ${a.key}.${invalidReport(invalid)}`, note: 'Form has missing or invalid fields' };
    const after = await ctx.browser.settleAfterAction(before, ctx.signal);
    return { output: `Pressed ${a.key}${submitted ? ' (submitted the form)' : ''}.${changeReport(after)}` };
  },
};

const wait: AgentTool<{ seconds: number; text?: string }> = {
  name: 'wait',
  description: 'Wait some seconds (max 10) or until a text appears.',
  schema: z.object({
    seconds: z.coerce.number().min(0.2).max(10).optional().default(2),
    text: z.string().optional().describe('Wait for this text'),
  }),
  risk: 'read',
  touchesPage: true,
  label: (a) => (a.text ? `Waiting for ${quote(a.text)}` : 'Waiting for the page'),
  async execute(a, ctx) {
    if (a.text) {
      const res = await ctx.browser.send({ kind: 'waitForText', text: a.text, timeoutMs: a.seconds * 1000 || 5000 });
      return { output: res.found ? `“${a.text}” is now on the page.` : `“${a.text}” did not appear within ${a.seconds}s.` };
    }
    await sleep(a.seconds * 1000, ctx.signal);
    return { output: `Waited ${a.seconds}s.` };
  },
};

function normalizeUrl(raw: string): string {
  const s = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  return `https://${s.replace(/^\/+/, '')}`;
}

const navigate: AgentTool<{ url: string }> = {
  name: 'navigate',
  description: 'Open a URL in this tab.',
  schema: z.object({ url: z.string().min(1).describe('Full URL') }),
  risk: 'read',
  touchesPage: false,
  label: (a) => `Opening ${siteOf(normalizeUrl(a.url)) || a.url}`,
  async execute(a, ctx) {
    const tab = await ctx.browser.navigate(normalizeUrl(a.url), ctx.signal);
    ctx.elements.clear();
    return { output: `Opened “${tab.title}” (${clip(tab.url ?? '', 160)}). Call read_page to see it.` };
  },
};

const goBack: AgentTool<Record<string, never>> = {
  name: 'go_back',
  description: 'Back a page in this tab.',
  schema: z.object({}),
  risk: 'read',
  touchesPage: false,
  label: () => 'Going back',
  async execute(_a, ctx) {
    const tab = await ctx.browser.history('back', ctx.signal);
    return { output: `Went back to “${tab.title}” (${clip(tab.url ?? '', 160)}).` };
  },
};

const goForward: AgentTool<Record<string, never>> = {
  name: 'go_forward',
  description: 'Forward a page in this tab.',
  schema: z.object({}),
  risk: 'read',
  touchesPage: false,
  label: () => 'Going forward',
  async execute(_a, ctx) {
    const tab = await ctx.browser.history('forward', ctx.signal);
    return { output: `Went forward to “${tab.title}” (${clip(tab.url ?? '', 160)}).` };
  },
};

const listTabs: AgentTool<Record<string, never>> = {
  name: 'list_tabs',
  description: 'This window\'s tabs with ids; (current) is yours.',
  schema: z.object({}),
  risk: 'read',
  touchesPage: false,
  label: () => 'Checking open tabs',
  async execute(_a, ctx) {
    const tabs = await ctx.browser.listTabs();
    return { output: tabs.map((t) => `[tab ${t.id}] ${clip(t.title || 'Untitled', 80)} — ${clip(t.url, 100)}${t.active ? ' (current)' : ''}`).join('\n'), note: `${tabs.length} tabs` };
  },
};

const openTab: AgentTool<{ url: string }> = {
  name: 'open_tab',
  description: 'Open a URL in a new tab and work there.',
  schema: z.object({ url: z.string().min(1) }),
  risk: 'read',
  touchesPage: false,
  label: (a) => `Opening ${siteOf(normalizeUrl(a.url)) || 'a page'} in a new tab`,
  async execute(a, ctx) {
    const tab = await ctx.browser.openTab(normalizeUrl(a.url), ctx.signal);
    ctx.elements.clear();
    return { output: `Opened [tab ${tab.id}] “${tab.title}” (${clip(tab.url ?? '', 160)}). You are now working in it.` };
  },
};

const switchTab: AgentTool<{ tab_id: number }> = {
  name: 'switch_tab',
  description: 'Work in another tab (id from list_tabs).',
  schema: z.object({ tab_id: z.coerce.number().int() }),
  risk: 'read',
  touchesPage: false,
  label: () => 'Switching tabs',
  async execute(a, ctx) {
    const tab = await ctx.browser.switchTab(a.tab_id);
    ctx.elements.clear();
    return { output: `Now working in [tab ${tab.id}] “${tab.title}” (${clip(tab.url ?? '', 160)}). Call read_page.`, note: clip(tab.title ?? '', 40) };
  },
};

const closeTab: AgentTool<{ tab_id?: number }> = {
  name: 'close_tab',
  description: 'Close a tab (default: this one); you then work in the active one.',
  schema: z.object({ tab_id: z.coerce.number().int().optional() }),
  risk: 'action',
  touchesPage: false,
  label: () => 'Closing a tab',
  async execute(a, ctx) {
    const res = await ctx.browser.closeTab(a.tab_id);
    ctx.elements.clear();
    return { output: `Closed tab ${res.closed}.${res.now ? ` Now working in “${res.now.title}” (${clip(res.now.url ?? '', 120)}).` : ''}` };
  },
};

/**
 * The records as the model reads them — all of them, within `budget` characters: what every record
 * repeats (the patient's banner) is said once, and each record gets an equal share of the rest.
 */
export function recordsOutput(records: string[], next: string, close: string, budget: number): string {
  const lines = records.map((r) => r.split('\n').map((l) => l.trim()).filter(Boolean));
  const counts = new Map<string, number>();
  for (const ls of lines) for (const l of new Set(ls)) counts.set(l, (counts.get(l) ?? 0) + 1);
  const shared = records.length >= 3 ? new Set([...counts].filter(([, n]) => n >= Math.ceil(records.length * 0.6)).map(([l]) => l)) : new Set<string>();
  const common = [...shared].join('\n');
  const own = lines.map((ls) => ls.filter((l) => !shared.has(l)).join('\n'));
  const head = `Read ${records.length} record${records.length === 1 ? '' : 's'} one after another with “${next}”${close ? `, then closed the viewer with “${close}”` : ''}. Nothing was typed or saved.`;
  const tail = `These are all ${records.length} records of the list, first to last. Answer from them — don't read them again.`;
  const per = Math.max(250, Math.floor((budget - head.length - tail.length - common.length - records.length * 20) / Math.max(1, records.length)));
  return [
    head,
    ...(common ? ['', 'The same on every record:', common] : []),
    '',
    own.map((r, i) => `### Record ${i + 1}\n${fitRecord(r, per)}`).join('\n\n'),
    '',
    tail,
  ].join('\n');
}

/** Lines that decide a record — its fields and its results' flags — are kept, whatever the room. */
const KEY_LINE = /^Fields —|\b(status|flag|abnormal|normal|high|low|critical|positive|negative|increased|decreased|elevated|reduced|alert|H|L|HH|LL)\b/i;

/** A record within `room` characters: its key lines always, then its other lines in order while they fit. */
function fitRecord(text: string, room: number): string {
  const lines = text.split('\n');
  let used = lines.filter((l) => KEY_LINE.test(l)).reduce((n, l) => n + l.length + 1, 0);
  const kept = lines.filter((l) => {
    if (KEY_LINE.test(l)) return true;
    if (used + l.length + 1 > room) return false;
    used += l.length + 1;
    return true;
  });
  return clip(kept.join('\n'), Math.max(room * 2, 600));
}

/** The text of the PDFs a pop-up shows — read from the files themselves (Chrome's viewer has no page text). */
async function pdfsText(ctx: ToolContext, urls: string[]): Promise<string> {
  const parts: string[] = [];
  for (const url of urls) {
    const cache = (ctx.pdfTexts ??= new Map());
    let text = cache.get(url);
    if (text === undefined) {
      const name = decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() || 'document');
      const file = await ctx.browser.send({ kind: 'fetchPdf', url }).catch(() => null);
      if (!file?.data) text = file?.error === 'not a PDF' ? '' : `PDF ${name}: couldn't open the file (${file?.error ?? 'no answer'}).`;
      else {
        try {
          const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
          const { pdfText } = await import('./pdfText');
          const pdf = await pdfText(bytes, 15, ctx.overviewTextChars ? 4_000 : 12_000);
          text = pdf.text.trim().length > 30
            ? `PDF ${name} (${pdf.pages} page${pdf.pages === 1 ? '' : 's'}${pdf.read < pdf.pages ? `, first ${pdf.read} read` : ''}) — its text:\n${pdf.text}`
            : `PDF ${name} (${pdf.pages} page${pdf.pages === 1 ? '' : 's'}): a scanned image — it has no text to read.`;
        } catch (err) {
          text = `PDF ${name}: couldn't read it (${err instanceof Error ? err.message : String(err)}).`;
        }
      }
      cache.set(url, text);
    }
    if (text) parts.push(text);
  }
  return parts.join('\n');
}

/** The text of the pop-up in front — the frames of other sites and the PDFs inside it included. */
async function popupText(ctx: ToolContext, shown?: { rows?: VisualRow[] }): Promise<string> {
  // No waiting for other pop-ups to settle: read_records waits for the record itself to change.
  const res = await ctx.browser.send({ kind: 'dialogs', waitMs: 1500, settle: false }).catch(() => null);
  const front = res?.dialogs[0];
  if (!front) return '';
  if (shown) shown.rows = front.rows;
  let text = front.fullText ?? front.text;
  if (front.frames?.length) {
    const inside = await ctx.browser.frameTexts(front.frames).catch(() => []);
    if (inside.length) text = [text, ...inside.map((f) => f.text)].join('\n');
  }
  if (front.pdfs?.length) text = [text, await pdfsText(ctx, front.pdfs)].filter(Boolean).join('\n');
  return text.trim();
}

/**
 * Reviewing a list of records (an inbox) one by one costs a model call per record and runs out of
 * steps. This opens the first record and goes through the viewer with its "Next" button by itself,
 * keeping each record's text, then closes the viewer — one step; the model reads them all at once.
 */
const readRecords: AgentTool<{ first: string; near: string; next: string; close: string; max: number; area: string; status_label: string; normal_values: string; empty_is_normal: boolean }> = {
  name: 'read_records',
  description:
    'Read many records in one step: opens the first, presses Next to the last, keeps each one\'s text and fields, closes the viewer. Saves nothing.',
  schema: z.object({
    first: z.coerce.string().optional().default('').describe('Text that opens the first record (its Subject); with area, empty = the one showing'),
    near: z.coerce.string().optional().default('').describe('Other text of its row, if first repeats'),
    next: z.coerce.string().optional().default('Next').describe('The Next button'),
    close: z.coerce.string().optional().default('Cancel').describe('The button closing the viewer'),
    max: z.coerce.number().int().min(1).max(100).optional().default(30).describe('At most this many records'),
    area: z.coerce.string().optional().default('').describe('Records show in the page, not a pop-up: text always in that part (from the site knowledge)'),
    status_label: z.coerce.string().optional().default('').describe('The word before each result’s flag (e.g. "Status"): normal and abnormal are counted'),
    normal_values: z.coerce.string().optional().default('Normal').describe('Flags meaning normal, comma-separated'),
    empty_is_normal: bool(false).describe('An empty flag is normal'),
  }),
  risk: 'action',
  touchesPage: true,
  label: (a) => `Reading the records one after another, from ${a.first.trim() ? quote(a.first) : 'the one showing'}`,
  async execute(a, ctx) {
    // The same list read again in this task: its records are in the conversation already.
    const inPage = !!a.area.trim();
    if (!a.first.trim() && !inPage) return { output: 'Say which record to open first: first = its text in the list (e.g. its Subject).', note: 'No first record given' };
    const start = a.first.trim() || (await ctx.browser.send({ kind: 'areaText', anchor: a.area, next: a.next }).catch(() => null))?.text.slice(0, 300) || a.area;
    const key = `${(await ctx.browser.currentTab().catch(() => null))?.url ?? ''}|${start.trim().toLowerCase()}`;
    const before = ctx.recordsRead?.get(key);
    if (before) {
      return { output: `You already read this list in this task — all ${before} records, in the read_records result above. Don't read it again: answer from that result.`, note: 'Already read — not again' };
    }
    if (a.first.trim()) {
      const opened = await clickText.execute({ text: a.first, near: a.near, double: false }, ctx);
      if (/Text not found|not clicked/.test(opened.note ?? '')) return opened;
      // A link to another page (“Go to Consult for …”) is not a record of the list.
      if (/new tab|new page/i.test(opened.note ?? '')) {
        return {
          output: `${opened.output}\nThat was not a record of the list: “${a.first}” opened another page. Go back to the list (close that tab if it is a new one), then call read_records again — with area, first empty starts from the record showing; or first = the record's own text in the list.`,
          note: 'Opened another page — not a record',
        };
      }
    }
    const records: string[] = [];
    const rowsOf: VisualRow[][] = [];
    const itemsOf: ({ text: string; red: boolean } | null)[] = [];
    // Whose record — the first line of a record shown in the page is its patient (or its owner).
    const whoOf: string[] = [];
    // The record now: in its pop-up, or — a record shown in the page — in the part of the page `area` names.
    let nextInPage: number | null = null;
    const recordText = async (shown: { rows?: VisualRow[]; item?: { text: string; red: boolean } | null }): Promise<string> => {
      if (!inPage) return popupText(ctx, shown);
      const res = await ctx.browser.send({ kind: 'areaText', anchor: a.area, next: a.next }).catch(() => null);
      shown.rows = res?.rows;
      shown.item = res?.listItem ?? null;
      nextInPage = res?.nextId ?? null;
      return res?.text ?? '';
    };
    let last = '';
    for (let i = 0; i < a.max; i++) {
      const shown: { rows?: VisualRow[]; item?: { text: string; red: boolean } | null } = {};
      let text = await recordText(shown);
      // The next record may take a moment to load.
      for (let tries = 0; tries < 12 && (!text || text === last); tries++) {
        await sleep(300);
        text = await recordText(shown);
      }
      if (!text || text === last) break;
      // In the page, the rest catches up a moment later (the list's selection, the results table): read it again.
      if (inPage) {
        await sleep(400);
        text = (await recordText(shown)) || text;
      }
      last = text;
      // Its entry in the list, which may say what the record doesn't (red: abnormal).
      records.push(shown.item ? `In the list: ${shown.item.text}${shown.item.red ? ' (in red)' : ''}\n${text}` : text);
      rowsOf.push(shown.rows ?? []);
      itemsOf.push(shown.item ?? null);
      whoOf.push(inPage ? (text.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, 60) : '');
      if (i === Math.min(a.max, inPage ? 100 : 50) - 1) break;
      // The list shows a page of entries at a time: at its end, “Load more” brings the rest — then Next goes on.
      for (let loads = 0; inPage && !nextInPage && loads < 3; loads++) {
        const found = await ctx.browser.send({ kind: 'find', query: 'Load more', limit: 6 }).catch(() => null);
        const more = found?.matches.find((m) => /^(load|show) more$/i.test(m.name.trim()));
        if (!more) break;
        await ctx.browser.send({ kind: 'click', id: more.id, highlight: false }).catch(() => undefined);
        await ctx.browser.send({ kind: 'settle', quietMs: 500, timeoutMs: 4000 }).catch(() => null);
        // Next turns on once the new entries have come.
        for (let tries = 0; tries < 10 && !nextInPage; tries++) {
          await recordText({});
          if (!nextInPage) await sleep(400);
        }
      }
      const next = inPage ? { id: nextInPage, disabled: false } : await ctx.browser.send({ kind: 'popupControl', name: a.next }).catch(() => null);
      if (!next?.id || next.disabled) break;
      await ctx.browser.send({ kind: 'click', id: next.id, highlight: false }).catch(() => undefined);
    }
    // Stopped at the limit in the page: the next record is opened, for a call that reads on from it.
    let more = false;
    if (inPage && records.length >= Math.min(a.max, 100) && nextInPage) {
      await ctx.browser.send({ kind: 'click', id: nextInPage, highlight: false }).catch(() => undefined);
      more = true;
    }
    if (!inPage) {
      const close = await ctx.browser.send({ kind: 'popupControl', name: a.close }).catch(() => null);
      if (close?.id) await ctx.browser.send({ kind: 'click', id: close.id, highlight: false }).catch(() => undefined);
      else await ctx.browser.send({ kind: 'key', key: 'Escape' }).catch(() => undefined);
    }
    if (!records.length) {
      return {
        output: inPage
          ? `${a.first.trim() ? `Clicked “${a.first}”, but no` : 'No'} record with “${a.area}” showed on the page. Read the page to see what it did.`
          : `Clicked “${a.first}”, but no record viewer (pop-up) opened. If the record now shows in the page itself, call read_records again with area = the text the site knowledge names for that part of the page, and first empty; don't read the page first. Otherwise read the page to see what it did.`,
        note: 'No record viewer opened',
      };
    }
    (ctx.recordsRead ??= new Map()).set(key, records.length);
    const rules = a.status_label.trim()
      ? { label: a.status_label.trim(), normal: a.normal_values.split(',').map((v) => v.trim()).filter(Boolean), emptyIsNormal: a.empty_is_normal }
      : null;
    const summary = rules ? statusSummary(records.map((text, i) => ({ text, rows: rowsOf[i], listItem: itemsOf[i], who: whoOf[i] })), rules, inPage) : '';
    const budget = (ctx.overviewTextChars ? 7_000 : 18_000) - summary.length;
    return {
      output: [
        summary,
        more ? `Stopped at ${records.length} records; there are more. The next one is open now: to read on, call read_records again with first empty and the same area.` : '',
        // Several calls for one list: the total, counted here — models add them up wrong.
        (ctx.recordsRead?.size ?? 0) > 1 ? `Read in this task so far: ${[...ctx.recordsRead!.values()].reduce((n, v) => n + v, 0)} records, in ${ctx.recordsRead!.size} calls (this one: ${records.length}).` : '',
        recordsOutput(records, a.next, inPage ? '' : a.close, Math.max(3_000, budget)),
      ]
        .filter(Boolean)
        .join('\n\n'),
      note: `${records.length} record${records.length === 1 ? '' : 's'} read`,
    };
  },
};

/** “red” rows of a list say something (abnormal results, overdue tasks) the page's text doesn't. */
export function tableOutput(t: TableResult): string {
  if (!t.found || !t.rows.length) return 'No list (table) with rows found here. Read the page to see what it shows.';
  const colours = new Map<string, number>();
  for (const r of t.rows) colours.set(r.colour, (colours.get(r.colour) ?? 0) + 1);
  const differ = colours.size > 1;
  const lines = t.rows.map((r, i) => `${i + 1}. ${r.cells.map((c) => c || '—').join(' | ')}${differ ? ` — ${r.colour ? `in ${r.colour}` : 'usual colour'}` : ''}`);
  const tally = [...colours].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${n} in ${c || 'the usual colour'}`).join(', ');
  return [
    `${t.total} row${t.total === 1 ? '' : 's'}${t.rows.length < t.total ? ` (first ${t.rows.length} listed)` : ''}.`,
    ...(t.headers.some(Boolean) ? [`Columns: ${t.headers.map((h) => h || '—').join(' | ')}`] : []),
    ...lines,
    differ ? `By colour: ${tally}. (What a colour means is in the site's knowledge.)` : 'All rows are in the same colour.',
  ].join('\n');
}

const readTable: AgentTool<{ near: string; max: number }> = {
  name: 'read_table',
  description:
    'Read a list or table: each row\'s cells and colour (red: abnormal) — to count or sort rows without opening them.',
  schema: z.object({
    near: z.coerce.string().optional().default('').describe('Text inside the list you mean — a column header or a row\'s text — when the page has more than one'),
    max: z.coerce.number().int().min(1).max(200).optional().default(100).describe('At most this many rows'),
  }),
  risk: 'read',
  touchesPage: true,
  label: (a) => (a.near ? `Reading the list with ${quote(a.near)}` : 'Reading the list'),
  async execute(a, ctx) {
    const t = await ctx.browser.send({ kind: 'table', near: a.near, max: a.max });
    return { output: tableOutput(t), note: t.found ? `${t.total} row${t.total === 1 ? '' : 's'}` : 'No list found' };
  },
};

export const BROWSER_TOOLS: AgentTool<any>[] = [
  readPage, findElement, scroll, wait, click, clickText, readTable, readRecords, hover, openMenu, type, clear, selectOption, pressKey, navigate, goBack, goForward, listTabs, openTab, switchTab, closeTab,
];

// Keep the UI catalogue and the implementations in lock-step.
for (const tool of BROWSER_TOOLS) {
  if (!toolMeta(tool.name)) throw new Error(`Tool ${tool.name} is missing from shared/constants/tools.ts`);
}

export type { ToolOutcome };
