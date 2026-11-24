import type { PatientPage } from '@/shared/types/config';
import { kindOfTask } from './modelRoute';

/**
 * What the code knows around the model's tool calls: whether a step's result did all a request asked, whether a page
 * has filled in, and the patient a page shows. The model does the task, with its tools: no request is done without it.
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

/** A step's result said it clicked what it was sent to, and nothing is in the way now (a pop-up, a refused form). */
export const stepWorked = (output: string) => /^(Clicked|Double-clicked|Opened .* and clicked)\b/.test(output) && !/NOT saved|NOT submitted|A dialog is showing/.test(output);

/** The page answered the click. */
export const pageMoved = (output: string) => !/nothing on the page changed|Only its look changed/i.test(output);

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
