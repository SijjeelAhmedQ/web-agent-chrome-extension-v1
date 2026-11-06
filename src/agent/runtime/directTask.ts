import type { PatientPage, SiteProfile, SiteShortcut } from '@/shared/types/config';
import { kindOfTask } from './modelRoute';

/**
 * Small tasks the code does alone, with no model call at all: a request that is one of a site's shortcuts (“goto
 * patients”), or that names one control on the page (“click search button”). Anything less sure goes to the model.
 */

const FILLER = /\b(please|plz|kindly|the|page|screen)\b/g;
/** A request or a name to compare: “Go to the Patients page.” and “goto patients”. */
const plain = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\bgo to\b/g, 'goto')
    .replace(FILLER, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const sameName = (a: string, b: string) => !!plain(a) && plain(a) === plain(b);

/** A patient's name in a shortcut's words: “show abnormal records of {patient}”. */
const SLOT = '{patient}';
/** What a name never is: “of this patient”, “of today”, or more than one thing. */
const NOT_A_NAME = /\b(this|that|these|those|his|her|their|my|patients?|today|aaj|yesterday|kal|week|month|and|then|aur|phir|or|records?|results?)\b/i;
const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The name in the slot of `say`, as the user wrote it, if the request is those words around a name. */
function nameIn(say: string, asked: string, source: string): string | null {
  const pattern = `^${escaped(plain(say.replace(SLOT, ' xslotx '))).replace('xslotx', '(.+)')}$`;
  const name = asked.match(new RegExp(pattern))?.[1]?.trim();
  if (!name || name.split(' ').length > 4 || NOT_A_NAME.test(name)) return null;
  const written = source.replace(/[^\p{L}\p{N}\s]/gu, ' ').match(new RegExp(name.split(' ').map(escaped).join('\\s+'), 'i'));
  return written?.[0] ?? name;
}

const withName = (c: SiteShortcut, name: string): SiteShortcut => {
  const put = (s: string) => s.split(SLOT).join(name);
  return {
    ...c,
    done: put(c.done),
    steps: c.steps.map((step) => ({ ...step, args: Object.fromEntries(Object.entries(step.args).map(([k, v]) => [k, typeof v === 'string' ? put(v) : v])) })),
  };
};

/**
 * The shortcut this whole request is: “goto patients and select arya” is more than one, and goes to the model.
 * `source`: where a name's capitals are, when the request was cut out of a longer one.
 */
export function shortcutFor(sites: SiteProfile[], request: string, source = request): SiteShortcut | null {
  const asked = plain(request);
  if (!asked) return null;
  for (const c of sites.flatMap((s) => s.shortcuts ?? [])) {
    for (const say of c.says) {
      if (!say.includes(SLOT)) {
        if (plain(say) === asked) return c;
        continue;
      }
      const name = nameIn(say, asked, source);
      if (name) return withName(c, name);
    }
  }
  return null;
}

/** The shortcut this request starts with, when more follows that a model does from there. */
export function leadingShortcut(sites: SiteProfile[], request: string): SiteShortcut | null {
  const asked = plain(request);
  return sites.flatMap((s) => s.shortcuts ?? []).find((c) => c.leads && c.says.some((say) => new RegExp(`^${plain(say)} (and|then|aur|phir) \\S`).test(asked))) ?? null;
}

/** What a request says after the shortcut it starts with: “goto smart inbox and show abnormal records” → “show abnormal records”. */
export function restAfter(shortcut: SiteShortcut, request: string): string {
  const asked = plain(request);
  for (const say of shortcut.says) {
    const rest = asked.match(new RegExp(`^${escaped(plain(say))} (?:and|then|aur|phir) (.+)$`))?.[1];
    if (rest) return rest;
  }
  return '';
}

/** The patient a page shows, from its controls' names and places; null if it doesn't say. */
export function patientFrom(page: PatientPage, controls: { name?: string; context?: string }[]): { name: string; nhi?: string } | null {
  const texts = controls.flatMap((c) => [c.context ?? '', c.name ?? '']).filter(Boolean);
  const first = (source?: string) => {
    if (!source) return undefined;
    const pattern = new RegExp(source);
    for (const t of texts) {
      const value = t.match(pattern)?.[1]?.trim();
      if (value) return value;
    }
    return undefined;
  };
  const name = first(page.name);
  if (!name) return null;
  const nhi = first(page.nhi);
  return nhi ? { name, nhi } : { name };
}

const NAMES_ONE = /^(?:please\s+)?(?:click|press|tap|go ?to|navigate to)\s+(?:on\s+)?(?:the\s+)?(.+)$/i;
const NAMES_ONE_URDU = /^(.+?)\s+(?:(?:par|pe)\s+)?(?:click karo|dabao)$/i;
const MORE_THAN_ONE = /\b(and|then|aur|phir|or|after|before|if|near|next to)\b|[,;:?]/i;

/** The control a request names and nothing more: “click search button” → “search”. Null for anything else. */
export function namedControl(request: string): string | null {
  if (kindOfTask(request).kind !== 'clicks') return null;
  const asked = request.trim().replace(/[.!]+$/, '');
  const named = asked.match(NAMES_ONE)?.[1] ?? asked.match(NAMES_ONE_URDU)?.[1];
  if (!named || MORE_THAN_ONE.test(named)) return null;
  const name = named.replace(/\s+(button|link|tab|icon|menu|page)$/i, '').trim();
  return name && name.length <= 40 ? name : null;
}

/** The request asks for a click itself, not to arrive somewhere: a click that changed nothing is still its answer. */
export const asksForClick = (request: string) => /^\s*(?:please\s+)?(click|press|tap)\b|(click karo|dabao)\s*[.!]*\s*$/i.test(request);

/** A step's result said it clicked what it was sent to, and nothing is in the way now (a pop-up, a refused form). */
export const stepWorked = (output: string) => /^(Clicked|Double-clicked|Opened .* and clicked|Selected|Typed)\b/.test(output) && !/NOT saved|NOT submitted|A dialog is showing/.test(output);

/** The page answered the click. */
export const pageMoved = (output: string) => !/nothing on the page changed|Only its look changed/i.test(output);

/** A click on a menu trigger opened its menu: clicked again, with the menu open, it really clicks. */
export const openedItsMenu = (output: string) => /opens a menu on hover/.test(output);

/**
 * Waits for a page that has just opened to fill in, from its number of controls every half second: done once that
 * number holds for `hold` milliseconds, and isn't next to nothing (the Smart AI Inbox: 1, then 30, then 157). Fifteen
 * seconds at most. Each read of it too soon was a call: wait, read, wait, read.
 */
export async function pageFilledIn(count: () => Promise<number>, pause: (ms: number) => Promise<void>, hold: number): Promise<void> {
  let last = await count();
  let held = 0;
  for (let waited = 0; waited < 15_000 && (last <= 3 || held < hold); waited += 500) {
    await pause(500);
    const now = await count();
    held = now === last ? held + 500 : 0;
    last = now;
  }
}

/** What the small model's one step was aimed at, in words: the menu's path, the text or the control's name. */
function aimOf(tool: string, args: Record<string, unknown>): string {
  if (tool === 'open_menu') return Array.isArray(args.path) ? args.path.join(' ') : String(args.path ?? '');
  if (tool === 'click_text') return String(args.text ?? '');
  if (tool === 'click') return String(args.name ?? '');
  return '';
}

/** One form of each word: “patient” is what “patients” asked for. */
const forms = (s: string) =>
  plain(s)
    .split(' ')
    .map((w) => (w.length > 3 ? w.replace(/s$/, '') : w));

/** The model's step did all the request asked (“goto appointments”: Appointments › Calendar opened): no call to say so. */
export function stepFinishes(request: string, tool: string, args: Record<string, unknown>, output: string): boolean {
  const name = namedControl(request);
  if (!name || !stepWorked(output) || !pageMoved(output)) return false;
  const aim = forms(aimOf(tool, args));
  return forms(name).every((w) => aim.includes(w));
}

const NEW_TEXT = /New on the page: (.+?)\.(?= The page| Call|$)/;
const MESSAGES = /Messages now on the page: (.+?)\.(?: |$)/;

/** What the user is told after a click no model looked at: the result's own facts, not its advice to the model. */
export function clickAnswer(name: string, output: string, pageTitle: string): string {
  if (!pageMoved(output)) return `Clicked **${name}**. Nothing on the page changed.`;
  const moved = /new tab or window|The page changed — now/.test(output);
  const said = [output.match(NEW_TEXT)?.[1], output.match(MESSAGES)?.[1]].filter(Boolean).join(' ');
  return `Clicked **${name}**.${moved && pageTitle ? ` **${pageTitle}** is open.` : ''}${said ? ` The page now shows: ${said}.` : ''}`;
}
