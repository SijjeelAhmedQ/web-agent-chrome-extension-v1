import type { KnowledgeKind } from '@/shared/types/config';
import { parseArguments, stripThinking } from '../llm/parse';
import type { ChatMessage } from '../llm/types';

/** What the explorer saw on one page or screen — what the model writes the knowledge from. */
export interface PageCapture {
  url: string;
  title: string;
  template: string;
  /** How the crawler got here: the page it came from and what it clicked (“Patients › Search & List”). */
  from?: { url: string; title: string; via: string };
  /** A screen of another page that has no address of its own (a tab, a view). */
  screenOf?: string;
  headings: string[];
  text: string;
  /** The page's controls, one per line: `button “Save”`, `link “Patients” → /patients`. */
  controls: string[];
  /** Fields of the page's forms, with the dummy value typed into them (forms are never submitted). */
  fields: string[];
  /** What each click did: “opens page …”, “opens pop-up …”, “opens a menu: …”, “needs your OK — skipped”. */
  clicks: string[];
  /** Pop-ups seen on this page: title, words, fields. */
  dialogs: string[];
  /**
   * Calls to the site's server that change data, made by a click or a save, and what it answered: a refusal's
   * message (“NHI already exists”), or the shape of what it sent back — never its values.
   */
  api?: string[];
}

export interface WrittenEntry {
  kind: KnowledgeKind;
  title: string;
  content: string;
  trigger?: string;
}

export interface WrittenKnowledge {
  entries: WrittenEntry[];
  neverClick: string[];
}

const KINDS: KnowledgeKind[] = ['rule', 'navigation', 'page', 'workflow'];

export const KNOWLEDGE_FORMAT = `Answer with JSON only, no other text:
{"entries":[{"kind":"page"|"navigation"|"rule"|"workflow","title":"short title","content":"markdown","trigger":"(workflows only) an example of what a user would ask"}],"neverClick":["exact names of buttons that must never be clicked"]}`;

export const KNOWLEDGE_ROLE = `You write the knowledge base of a website for a browser automation agent. The agent reads it before it works on the site, so it must say exactly where things are and how to operate them.
Write in English. Use the controls' exact names in quotes ("Search & List"). Only write what the page data shows — never invent controls, pages or data. Leave out personal data (patients', customers' names, numbers): describe the kind of data, not the records.
Kinds:
- page: one entry per page or screen, titled "<Page name> page": what it shows, its sections, columns, filters, buttons and what they do, its pop-ups and their fields.
- navigation: how to reach this page: menu path and/or address (path only).
- rule: an always/never fact about operating the site that the data shows (a menu that opens on hover, a required field, a button that saves at once, a pop-up that must be closed).
- workflow: a task this page is clearly for (search, open, create, edit, filter), as numbered steps with exact control names. The trigger is a short example request. Steps that save, send or delete end with "(the approval card asks the user)" — the agent's app asks for the OK itself; never write that the agent should ask or confirm in words.
Forms: list each form's fields in its page entry, marking required ones, and every dropdown with its choices ("options: …") so the agent can pick a valid one. A line "Saving … with test values" tells what the form did when saved: the fields it marked wrong and the messages it showed are the form's requirements (required fields, formats such as a date or phone pattern) — write them as a rule titled "<Form name> requirements". Copy each requirement exactly as the form gave it — every field it called required or marked wrong, and each format with its example (e.g. "NHI: 3 letters then 4 characters, e.g. ABC1235"; "Location: latitude,longitude, e.g. -36.8485,174.7633"). A form that "closed — saved" was saved by its button: say which button saves it.
Calls to the server: each line is what a click or save sent to the site's server (method and address) and its answer. In the form's page entry, say which call its save makes ("Save" → POST /api/patients). A call the server "refused" is a rule of the site, even when the page showed nothing: write it into the "<Form name> requirements" rule with the server's own words (e.g. "The server refuses a second practice member with the same NHI: 'NHI already exists'"). Leave out ids and values; field names are fine.
neverClick: only buttons that are destructive and irreversible here (e.g. "Delete", "Delete account"). Usually empty.`;

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const section = (title: string, lines: string[], max: number) => (lines.length ? `${title}:\n${clip(lines.join('\n'), max)}\n` : '');

/** The page as the model reads it, within `budget` characters. */
export function describePage(p: PageCapture, budget: number): string {
  const b = Math.max(3000, budget);
  return [
    `Address: ${p.url}`,
    `Title: ${p.title || '(none)'}`,
    p.screenOf ? `This is a screen inside the page ${p.screenOf} (the address does not change).` : '',
    p.from ? `Reached from "${p.from.title}" by clicking: ${p.from.via}` : 'This is where the crawl started.',
    section('Headings', p.headings, b * 0.06),
    // What its forms require (a save refused, the fields it marked, the formats it asked for) comes first and whole:
    // it is what the agent most needs to fill them in right.
    section('Saving forms with test values (what each form requires)', p.dialogs.filter((d) => d.startsWith('Saving ')), b * 0.1),
    section('Calls to the server (what the site saves, and what it refuses)', p.api ?? [], b * 0.08),
    section('Form fields (dropdowns with their choices)', [...new Set(p.fields)], b * 0.2),
    section('Pop-ups', p.dialogs.filter((d) => !d.startsWith('Saving ')), b * 0.12),
    section('Controls', p.controls, b * 0.22),
    section('What clicking showed', p.clicks, b * 0.14),
    p.text ? `Text on the page:\n${clip(p.text, b * 0.14)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function pagePrompt(p: PageCapture, budget: number): ChatMessage[] {
  return [
    { role: 'system', content: `${KNOWLEDGE_ROLE}\n\n${KNOWLEDGE_FORMAT}` },
    {
      role: 'user',
      content: `Write the knowledge for this page: one "page" entry, one "navigation" entry, and rules or workflows only when the data clearly shows them.\n\n${describePage(p, budget)}`,
    },
  ];
}

/**
 * The last call: the whole site at once — the map of its pages and what is known — for the site's navigation,
 * its rules and its workflows (tasks that go over more than one page).
 */
export function sitePrompt(siteName: string, pages: { title: string; url: string; via?: string }[], known: string[], notes: string[], budget: number): ChatMessage[] {
  const map = pages.map((p) => `- ${p.title || '(untitled)'} — ${pathOf(p.url)}${p.via ? ` — reached by: ${p.via}` : ''}`);
  return [
    { role: 'system', content: `${KNOWLEDGE_ROLE}\n\n${KNOWLEDGE_FORMAT}` },
    {
      role: 'user',
      content: [
        `The crawl of ${siteName} is done. From the site map and the knowledge so far, write:`,
        `1. One "navigation" entry titled "Site map and main menu": the main menu and where each page is.`,
        `2. "workflow" entries for the 3 to 8 most useful tasks on this site, each with numbered steps across the pages and an example request as trigger.`,
        `3. "rule" entries for anything that holds for the whole site.`,
        `Do not repeat page entries.`,
        '',
        section('Site map', map, budget * 0.5),
        section('Knowledge so far (titles and first lines)', known, budget * 0.35),
        section('Notes from the crawl', notes, budget * 0.1),
      ].join('\n'),
    },
  ];
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}${u.hash}` || '/';
  } catch {
    return url;
  }
}

/** The model's answer as entries — tolerant of fences, thinking and small JSON slips; nothing usable → empty. */
export function parseWritten(raw: string): WrittenKnowledge {
  const text = stripThinking(raw);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return { entries: [], neverClick: [] };
  const { value } = parseArguments(text.slice(start, end + 1));
  const list = Array.isArray(value.entries) ? value.entries : [];
  const entries: WrittenEntry[] = [];
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>;
    const kind = String(r.kind ?? '').toLowerCase() as KnowledgeKind;
    const title = typeof r.title === 'string' ? r.title.trim() : '';
    const content = typeof r.content === 'string' ? r.content.trim() : Array.isArray(r.content) ? r.content.map(String).join('\n').trim() : '';
    if (!KINDS.includes(kind) || !title || !content) continue;
    const trigger = typeof r.trigger === 'string' ? r.trigger.trim() : '';
    entries.push({ kind, title: clip(title, 100), content: clip(content, 4000), ...(kind === 'workflow' ? { trigger } : {}) });
  }
  const neverClick = (Array.isArray(value.neverClick) ? value.neverClick : []).filter((n): n is string => typeof n === 'string' && !!n.trim()).map((n) => n.trim());
  return { entries, neverClick };
}

/** Characters of page data that fit a model with this context window (tokens), leaving room for the answer. */
export function budgetFor(contextWindow: number | undefined): number {
  if (!contextWindow) return 24_000;
  return Math.max(4_000, Math.min(30_000, Math.round((contextWindow - 4_000) * 2.6)));
}
