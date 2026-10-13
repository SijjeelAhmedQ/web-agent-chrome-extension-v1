import { z } from 'zod';
import { PageError } from '@/extension/browser/controller';
import { toolMeta } from '@/shared/constants/tools';
import { clip, siteOf, sleep } from '@/shared/utils';
import { classifyClick, classifySubmit, classifyTyping } from '../execution/riskPolicy';
import { formatElement, formatSnapshot } from './format';
import type { AgentTool, ApprovalRequest, ToolContext, ToolOutcome } from './types';

/**
 * The generic browser tools. Nothing here knows about any particular website: every tool
 * works from the page-understanding layer's element ids and plain DOM semantics.
 */

const id = z.coerce.number().int().positive().describe('Element id from the latest read_page or find_element result');
const bool = (fallback: boolean) =>
  z.preprocess((v) => (typeof v === 'string' ? v.toLowerCase() === 'true' : v), z.boolean().optional().default(fallback));

const quote = (s: string) => `“${clip(s, 40)}”`;

function nameOf(ctx: ToolContext, elementId: number, fallback = 'the element'): string {
  const e = ctx.elements.get(elementId);
  return e?.name ? quote(e.name) : fallback;
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
): Promise<ApprovalRequest | null> {
  let info;
  try {
    info = await ctx.browser.send({ kind: 'describe', id: elementId });
  } catch {
    return null; // the action itself will report the problem
  }
  const verdict = kind === 'click' ? classifyClick(info) : kind === 'submit' ? classifySubmit(info) : classifyTyping(info);
  if (!verdict.consequential) return null;
  const site = siteOf(await pageUrl(ctx)) || 'this site';
  return {
    title: action,
    detail: `This will ${verdict.consequence} on ${site}.${kind !== 'type' && info.formValues?.length ? ' Check the details:' : ''}`,
    confirmLabel: kind === 'type' ? 'Allow' : 'Confirm',
    ...(kind !== 'type' && info.formValues?.length ? { fields: info.formValues } : {}),
  };
}

const readPage: AgentTool<{ mode: 'overview' | 'content' }> = {
  name: 'read_page',
  description:
    'Read the current page. Returns its URL, title, scroll position, a numbered list of interactive elements as `[id] role "name"` and the visible text. Use mode "content" to get the full text when you need to read, compare or summarize. Call again after the page changes — ids from an older page are invalid.',
  schema: z.object({ mode: z.enum(['overview', 'content']).optional().default('overview').describe('"overview" (default) or "content" for the full text') }),
  risk: 'read',
  touchesPage: true,
  label: (a) => (a.mode === 'content' ? 'Reading the page content' : 'Reading the page'),
  async execute(a, ctx) {
    const snap = await ctx.browser.send({ kind: 'snapshot', mode: a.mode, maxElements: ctx.settings.maxElements, maxTextChars: ctx.settings.maxTextChars });
    ctx.elements.remember(snap.elements);
    const n = snap.elements.length + snap.omitted;
    return { output: formatSnapshot(snap, a.mode), note: `${n} controls · ${clip(snap.title || siteOf(snap.url), 40)}` };
  },
};

const findElement: AgentTool<{ query: string }> = {
  name: 'find_element',
  description: 'Find interactive elements matching a description (e.g. "search box", "Add to cart button", "email field") and any matching visible text. Useful on long pages or when read_page listed too many elements.',
  schema: z.object({ query: z.string().min(1).describe('What to look for, in plain words') }),
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
    if (res.textMatches.length) lines.push('', 'Matching text on the page:', ...res.textMatches.map((t) => `- ${t}`));
    return { output: lines.join('\n'), note: res.matches[0] ? `Found ${quote(res.matches[0].name || res.matches[0].role)}` : 'Found matching text' };
  },
};

const click: AgentTool<{ id: number }> = {
  name: 'click',
  description: 'Click an element (button, link, tab, checkbox, menu item, row…). Waits for the page to react.',
  schema: z.object({ id }),
  risk: 'sensitive',
  touchesPage: true,
  label: (a, ctx) => `Clicking ${nameOf(ctx, a.id)}`,
  assess: (a, ctx) => approvalFor(ctx, a.id, 'click', `Click ${nameOf(ctx, a.id, 'this')}?`),
  async execute(a, ctx) {
    const before = await pageUrl(ctx);
    let res;
    try {
      res = await ctx.browser.send({ kind: 'click', id: a.id, highlight: ctx.settings.highlightActions });
    } catch (err) {
      if (err instanceof PageError && err.code === 'navigating') {
        const after = await ctx.browser.settleAfterAction(before, ctx.signal);
        return { output: `Clicked.${changeReport({ ...after, navigated: true })}`, note: 'Opened a new page' };
      }
      throw err;
    }
    const label = res.element.name ? quote(res.element.name) : 'the element';
    if (res.opensNewTab) {
      const tab = await ctx.browser.openTab(res.opensNewTab, ctx.signal);
      return { output: `${label} opens in a new tab, so I opened it: “${tab.title}” (${clip(tab.url ?? '', 120)}). You are now working in that tab. Call read_page.`, note: 'Opened in a new tab' };
    }
    const after = await ctx.browser.settleAfterAction(before, ctx.signal);
    const covered = res.covered ? ' Note: something was covering it (a pop-up or banner?) — check the result.' : '';
    if (res.invalidFields) return { output: `Clicked ${label}.${invalidReport(res.invalidFields)}`, note: 'Form has missing or invalid fields' };
    return { output: `Clicked ${label}.${changeReport(after)}${covered}`, note: after.navigated ? 'Opened a new page' : undefined };
  },
};

const type: AgentTool<{ id: number; text: string; clear: boolean; submit: boolean }> = {
  name: 'type',
  description: 'Type text into a text field, search box, combobox or editor. Replaces the existing text unless clear is false. Set submit to true to press Enter afterwards (e.g. to run a search).',
  schema: z.object({
    id,
    text: z.coerce.string().describe('The text to type'),
    clear: bool(true).describe('Replace existing text (default true)'),
    submit: bool(false).describe('Press Enter after typing (default false)'),
  }),
  risk: 'action',
  touchesPage: true,
  label: (a, ctx) => {
    const shown = isSecretField(ctx, a.id) ? '••••' : quote(a.text);
    const target = ctx.elements.get(a.id)?.name;
    return `Typing ${shown}${target ? ` into ${quote(target)}` : ''}`;
  },
  async assess(a, ctx) {
    const typing = await approvalFor(ctx, a.id, 'type', `Type into ${nameOf(ctx, a.id, 'this field')}?`);
    if (typing) return typing;
    return a.submit ? approvalFor(ctx, a.id, 'submit', 'Submit this form?') : null;
  },
  async execute(a, ctx) {
    const before = await pageUrl(ctx);
    const res = await ctx.browser.send({ kind: 'type', id: a.id, text: a.text, clear: a.clear, highlight: ctx.settings.highlightActions });
    const label = res.element.name ? quote(res.element.name) : 'the field';
    let output = `Typed into ${label}. It now contains: ${quote(res.value)}.`;
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
    return { output };
  },
};

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
  description: 'Choose an option in a native dropdown (<select>) by its visible text. For custom dropdowns, click to open them and then click the option instead.',
  schema: z.object({ id, option: z.coerce.string().describe('Visible text of the option') }),
  risk: 'action',
  touchesPage: true,
  label: (a, ctx) => `Choosing ${quote(a.option)}${ctx.elements.get(a.id)?.name ? ` in ${nameOf(ctx, a.id)}` : ''}`,
  async execute(a, ctx) {
    const res = await ctx.browser.send({ kind: 'select', id: a.id, option: a.option, highlight: ctx.settings.highlightActions });
    await ctx.browser.send({ kind: 'settle', quietMs: 300, timeoutMs: 1500 }).catch(() => null);
    return { output: `Selected ${quote(res.selected)} in ${res.element.name ? quote(res.element.name) : 'the dropdown'}.` };
  },
};

const scroll: AgentTool<{ direction?: 'up' | 'down' | 'top' | 'bottom'; id?: number }> = {
  name: 'scroll',
  description: 'Scroll the page up or down by about a screen, to the top or bottom, or until a specific element is visible (pass id). Use it to reveal content marked ↓ or load more results.',
  schema: z.object({
    direction: z.enum(['up', 'down', 'top', 'bottom']).optional().describe('Default "down"'),
    id: id.optional().describe('Scroll this element into view instead'),
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
    'Move the mouse over an element without clicking. Opens menus that appear on hover (navigation bars, dropdown menus), tooltips and previews. Returns the items that appeared, with their ids — then hover the next level or click the item you want.',
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
    'Open nested menus one level at a time by their visible labels, e.g. ["Products", "Laptops"] — each level is hovered (or clicked if it is a menu button) and the next label is looked for in what opened. Returns the items of the last level with their ids; then click the item you want. Use it for navigation bars with sub-menus.',
  schema: z.object({ path: pathSchema.describe('Menu labels from the top level down, without the final item to click') }),
  risk: 'read',
  touchesPage: true,
  label: (a) => `Opening ${a.path.map((p) => quote(p)).join(' › ')}`,
  async execute(a, ctx) {
    const res = await ctx.browser.send({ kind: 'menuPath', path: a.path, highlight: ctx.settings.highlightActions });
    ctx.elements.remember([...res.revealed, ...(res.options ?? [])]);
    const trail = res.opened.length ? res.opened.map((p) => quote(p)).join(' › ') : 'nothing';
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

const pressKey: AgentTool<{ key: string; id?: number }> = {
  name: 'press_key',
  description: 'Press a key: Enter, Escape, Tab, ArrowDown, ArrowUp, Backspace, Space, etc. Sent to the element with that id, or to the focused element. Enter in a form field submits the form; Escape closes most pop-ups.',
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
  description: 'Wait for the page: either a number of seconds (max 10), or until some text appears.',
  schema: z.object({
    seconds: z.coerce.number().min(0.2).max(10).optional().default(2),
    text: z.string().optional().describe('Wait until this text is on the page'),
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
  description: 'Open a web address in the current tab.',
  schema: z.object({ url: z.string().min(1).describe('Full URL, e.g. https://www.google.com') }),
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
  description: 'Go back to the previous page in this tab.',
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
  description: 'Go forward to the next page in this tab.',
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
  description: 'List the open tabs in this window with their ids. The one marked (current) is where you are working.',
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
  description: 'Open a URL in a new tab and continue working there.',
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
  description: 'Switch to another open tab (ids from list_tabs) and continue working there.',
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
  description: 'Close a tab (default: the current one). Afterwards you work in whichever tab becomes active.',
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

export const BROWSER_TOOLS: AgentTool<any>[] = [
  readPage, findElement, scroll, wait, click, hover, openMenu, type, clear, selectOption, pressKey, navigate, goBack, goForward, listTabs, openTab, switchTab, closeTab,
];

// Keep the UI catalogue and the implementations in lock-step.
for (const tool of BROWSER_TOOLS) {
  if (!toolMeta(tool.name)) throw new Error(`Tool ${tool.name} is missing from shared/constants/tools.ts`);
}

export type { ToolOutcome };
