import type { SiteProfile, SiteShortcut } from '@/shared/types/config';
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

/** The shortcut this whole request is: “goto patients and select arya” is more than one, and goes to the model. */
export function shortcutFor(sites: SiteProfile[], request: string): SiteShortcut | null {
  const asked = plain(request);
  if (!asked) return null;
  return sites.flatMap((s) => s.shortcuts ?? []).find((c) => c.says.some((say) => plain(say) === asked)) ?? null;
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
export const stepWorked = (output: string) => /^(Clicked|Double-clicked|Opened .* and clicked)\b/.test(output) && !/NOT saved|NOT submitted|A dialog is showing/.test(output);

/** The page answered the click. */
export const pageMoved = (output: string) => !/nothing on the page changed|Only its look changed/i.test(output);

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
