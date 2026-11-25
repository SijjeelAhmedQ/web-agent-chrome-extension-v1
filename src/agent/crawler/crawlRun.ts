import { BrowserController, PageError } from '@/extension/browser/controller';
import { describeCall } from '@/extension/browser/netWatch';
import { crawlerSettings } from '@/shared/constants/defaults';
import { recordCall } from '@/shared/storage/costLedger';
import type { AgentConfig, AppConfig, CrawledPage, CrawlerSettings, KnowledgeBase, ProviderConfig } from '@/shared/types/config';
import type { ClickResult } from '@/extension/messaging/protocol';
import type { DialogInfo, ElementInfo, PageSnapshot } from '@/shared/types/page';
import { sleep, uid } from '@/shared/utils';
import { createClient } from '../llm';
import type { LlmClient } from '../llm/types';
import { contextWindowOf, resolveProvider } from '../runtime/agentRun';
import { meteredClient } from '../runtime/costLog';
import { saveCrawl, type SavedCrawl } from './savedCrawl';
import { addProposals, hostOf, type ProposedEntry } from './merge';
import { budgetFor, pagePrompt, parseWritten, sitePrompt, type PageCapture } from './prompts';
import { dangerOf, dummyFor, exampleIn, isSameScreen } from './risk';
import { isLoginUrl, isLogoutUrl, normalizeUrl, pageOfScreen, sameSite, templateOf } from './urls';

/**
 * The Knowledge Gather Agent: explores one website in the user's own tab — in front of them — and writes its
 * knowledge base. Code decides where to go (every link and every control of every kind of page, breadth first);
 * the model only writes what each page is, page by page while exploring goes on, then the site's navigation and
 * workflows at the end. Nothing is saved: the user reviews the entries and saves them.
 *
 * - Clicks everything, but a control that deletes, sends, saves, pays, submits or signs out waits for the user's OK.
 * - Fills forms with dummy values (the e-mail from the settings) and never submits them.
 * - Stays on the site's host; a tab another site opens is offered for a crawl of its own.
 * - A page limit (50), then asks: 25 more each time.
 * - Session gone (the login page shows): stops, asks the user to sign in, and carries on from there.
 */

/** explored: the whole site was read and is shown to the user; the model writes when they say so. */
export type CrawlPhase = 'exploring' | 'paused' | 'explored' | 'writing' | 'review' | 'cancelled' | 'failed';

export type CrawlPrompt =
  | { id: string; kind: 'approval'; name: string; why: string; page: string }
  | { id: string; kind: 'limit'; count: number; more: number }
  | { id: string; kind: 'session'; url: string; first: boolean }
  | { id: string; kind: 'model'; error: string }
  | { id: string; kind: 'budget'; spent: number; limit: number };

type NewPrompt = CrawlPrompt extends infer P ? (P extends CrawlPrompt ? Omit<P, 'id'> : never) : never;

export type CrawlAnswer = 'allow' | 'skip' | 'skip-all' | 'more' | 'finish' | 'resume' | 'retry';

export interface OtherSite {
  host: string;
  url: string;
  tabId: number | null;
}

export interface CrawlState {
  id: string;
  phase: CrawlPhase;
  host: string;
  siteName: string;
  startUrl: string;
  model: string;
  pagesDone: number;
  limit: number;
  queued: number;
  doing: string;
  current: { url: string; title: string } | null;
  log: { at: number; text: string; tone?: 'warn' | 'ok' }[];
  proposals: ProposedEntry[];
  neverClick: string[];
  pages: CrawledPage[];
  prompts: CrawlPrompt[];
  writing: { done: number; total: number };
  /** Dollars the model has cost writing so far (as the server reports them). */
  spent: number;
  /** What was read on each page and screen (headings, controls, fields, clicks, pop-ups, text). */
  captures: PageCapture[];
  otherSites: OtherSite[];
  error?: string;
  startedAt: number;
  /** Minutes spent exploring (time it waited for the user not counted), and the limit (0: none). */
  minutes: number;
  timeLimit: number;
}

export interface CrawlOptions {
  config: AppConfig;
  agent: AgentConfig;
  windowId: number;
  tabId: number | null;
  /** Where to start; empty → the page the tab is on. */
  startUrl: string;
  /** The gathered knowledge base of this site so far (entries there are marked as updates). */
  existing?: KnowledgeBase;
  /** Overrides of the crawler settings for this crawl (page limit, model). */
  overrides?: Partial<CrawlerSettings>;
  /** The knowledge base what is learned is saved into as it goes (kept with the crawl, for opening it again). */
  base?: KnowledgeBase | null;
  mode?: 'update' | 'replace';
  onState: (state: CrawlState) => void;
}

export interface Target {
  url: string;
  from?: { url: string; title: string; via: string };
}

/** Where exploring was — enough to carry on after the panel closed or the extension reloaded. */
export interface ExploreState {
  queue: Target[];
  /** The page being read when it was kept (read again on carrying on). */
  visiting: Target | null;
  seenUrls: string[];
  templates: string[];
  clickedNames: [string, string][];
  skipAll: string[];
  screens: string[];
  labelPages: [string, number][];
  pagesWithControls: number;
  anyOutcome: [string, string][];
  siblingClicks: [string, { template: string; outcome: string }][];
  clickedKinds: [string, string][];
  filledPopups: string[];
  savedForms: string[];
  partOfPage: string[];
  loginPage: string;
  limit: number;
  /** Exploring time used so far. */
  usedMs: number;
}

const MAX_LOG = 80;
const MAX_CONTROLS = 260;
/** Fields filled on one page or pop-up — all of a usual form. */
const MAX_FIELDS = 80;
/** A pop-up with no title being filled: a pop-up over it can't be told from it, so none is closed. */
const UNTITLED = '(an untitled pop-up)';
const CLICKABLE = new Set(['button', 'tab', 'menuitem', 'clickable', 'link', 'treeitem', 'switch']);
/** Phases whose crawl is kept in storage (until its knowledge is saved or the user discards it). */
const KEPT_PHASES = new Set<CrawlPhase>(['exploring', 'paused', 'explored', 'writing', 'review']);
const captureKey = (c: Pick<PageCapture, 'url' | 'title'>) => `${c.url}|${c.title}`;
/** Dropdowns opened on one page or pop-up to read their choices. */
const MAX_DROPDOWNS = 40;
/** A pop-up that changes a record already there (any language the words are added in): never saved with test values. */
// A word on its own, or one a title runs into its heading without a space (“Practice membersEdit practice member”).
/** A form whose save does something in the world (books, pays, sends): never saved with test values. */
export const REAL_EFFECT_FORM = { test: (t: string) => /\b(book|booking|appointment|pay|payment|invoice|charge|refund|order|send|message|e-?mail|sms|invite|invitation|notify|remind)/i.test(t.replace(/([a-z])([A-Z])/g, '$1 $2')) };
export const EDIT_FORM = { test: (title: string) => /\b(edit|update|change|modify|rename|reset|move|transfer|merge|delete|remove|deactivate|void|cancel)\b/i.test(title.replace(/([a-z])([A-Z])/g, '$1 $2')) };
/** A pop-up form's finishing button (any of these words first). */
const SAVE_BUTTON = /^(save|create|add|register|submit|book|confirm|update|apply|done|start|record|send|ok)\b/i;

/** A choice that is no choice: “Choose…”, “Select a provider”, “All”, “None”, “—”. */
export const PLACEHOLDER_CHOICE = /^(choose|select|please|pick|--|—|-|none|all|any|no\b|n\/a)/i;

/** The field already shows a real choice (not its placeholder). */
const hasChoice = (e: Pick<ElementInfo, 'value'>) => !!e.value?.trim() && !PLACEHOLDER_CHOICE.test(e.value.trim());

/** A date field: a native date input, a field whose mask says it (“DD/MM/YYYY”), or one named a date. */
export const isDateField = (e: Pick<ElementInfo, 'role' | 'type' | 'name' | 'label' | 'placeholder'>) =>
  ['date', 'datetime-local', 'month', 'week'].includes((e.type ?? '').toLowerCase()) ||
  /\b(dd|mm)\s*[/.-]\s*(mm|dd)\b|\byyyy\s*-\s*mm\b/i.test(e.placeholder ?? '') ||
  ((e.role === 'textbox' || e.role === 'button' || e.role === 'combobox') && /\b(date|dob|birth(day| date)?|date range)\b/i.test(`${e.name} ${e.label ?? ''}`));

/** A time field (“Start time”, “Ends”, a native time input, an “hh:mm” mask) — not a date one. */
export const isTimeField = (e: Pick<ElementInfo, 'role' | 'type' | 'name' | 'label' | 'placeholder'>) =>
  !isDateField(e) &&
  ((e.type ?? '').toLowerCase() === 'time' ||
    /\bhh\s*:\s*mm\b|--\s*:\s*--/i.test(e.placeholder ?? '') ||
    (['textbox', 'button', 'combobox'].includes(e.role) && /\btime\b|^\s*(start|end|starts|ends|start at|ends at)\s*\*?\s*$/i.test(`${e.label || e.name}`)));

/** A test time the way the field takes it: 10:30 (an end 11:00), with AM/PM when its mask shows one. */
export function timeFor(e: Pick<ElementInfo, 'type' | 'name' | 'label' | 'placeholder'>): string {
  const end = /\b(end|ends|finish|to|until)\b/i.test(`${e.name} ${e.label ?? ''}`);
  const t = end ? '11:00' : '10:30';
  return (e.type ?? '').toLowerCase() !== 'time' && /\b(am|pm|a|p)\b|aa|tt/i.test(e.placeholder ?? '') ? `${t} AM` : t;
}

/** Two dates in one field (“From – To”). */
export const isDateRange = (e: Pick<ElementInfo, 'name' | 'label' | 'placeholder'>) => /range|\bfrom\b.*\bto\b|\s[–-]\s/i.test(`${e.name} ${e.label ?? ''} ${e.placeholder ?? ''}`);

/** A date written the way the field asks: its mask (DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD), else ISO for a native input. */
export function formatDate(d: Date, e: Pick<ElementInfo, 'type' | 'placeholder'>): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const [y, m, day] = [d.getFullYear(), p(d.getMonth() + 1), p(d.getDate())];
  const type = (e.type ?? '').toLowerCase();
  if (type === 'date') return `${y}-${m}-${day}`;
  if (type === 'datetime-local') return `${y}-${m}-${day}T09:00`;
  if (type === 'month') return `${y}-${m}`;
  const mask = (e.placeholder ?? '').toUpperCase();
  const sep = /[/.-]/.exec(mask)?.[0] ?? '/';
  if (/^YYYY/.test(mask)) return `${y}${sep}${m}${sep}${day}`;
  if (/^MM/.test(mask)) return `${m}${sep}${day}${sep}${y}`;
  return `${day}${sep}${m}${sep}${y}`;
}

/** The message names this field: its whole label, or a telling word of it (“NHI” of “NHI Number”). */
export function mentions(message: string, label: string): boolean {
  const m = message.toLowerCase();
  const l = label.replace(/[*:]/g, '').trim().toLowerCase();
  if (l.length > 2 && m.includes(l)) return true;
  const words = l.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w));
  return words.some((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u').test(m));
}
const GENERIC_WORDS = new Set(['number', 'name', 'date', 'field', 'the', 'and', 'for', 'type', 'code', 'select', 'choose', 'enter', 'your', 'new', 'add', 'value']);

/** Words of a message that reports a problem (not a field's help text). */
export const ERROR_WORDS = /required|must|invalid|wrong|already|exist|duplicate|taken|unique|not valid|cannot|can't|enter|choose|select|missing|format|should|too (short|long)|at least|no more than|error|failed/i;

/**
 * Another value in the same shape — letters stay letters (upper or lower), digits stay digits, the rest stays — for a
 * value the form says is taken (“ABC1235” → “QZK4821”). I and O are left out (codes often do not use them).
 */
export function uniqueLike(v: string): string {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const r = (n: number) => Math.floor(Math.random() * n);
  const out = v.replace(/[A-Za-z0-9]/g, (c) => (/\d/.test(c) ? String(r(10)) : /[A-Z]/.test(c) ? L[r(L.length)] : L[r(L.length)].toLowerCase()));
  return out === v ? `${v}${r(10)}` : out;
}

/**
 * The kind of a control that comes in a series told apart by a time, date or number — “Book 12:15 in Bessie Swinney”
 * → “book #”, “Monday 2 November · No coverage” → “monday # november · no coverage”-like kinds share a first word and
 * a number. Null for a control without a number in its name.
 */
export function sameKindOf(label: string): string | null {
  const l = label.toLowerCase().trim();
  const at = l.search(/\d/);
  if (at < 0) return null;
  // Its words before the first number, with the number itself made general: “book #”, “edit mapping — adjustment × #”.
  const head = l.slice(0, at).replace(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/g, '#day').trim();
  return `${head || '#'} #`;
}

/** A box that searches or filters the page's list (a search box, or a field in its toolbar), not a form's field. */
export const isListFilter = (e: Pick<ElementInfo, 'role' | 'name' | 'label' | 'placeholder' | 'context' | 'inBlockingPopup'>) =>
  !e.inBlockingPopup && (e.role === 'searchbox' || /\b(search|filter|find)\b/i.test(`${e.name} ${e.label ?? ''} ${e.placeholder ?? ''}`) || /^bar\b/.test(e.context ?? ''));

/** A field that opens a list to choose from: a combobox, or a text box that says it opens one (not a button that folds a panel). */
export const isDropdown = (e: Pick<ElementInfo, 'role' | 'expanded' | 'readonly' | 'disabled' | 'options' | 'picks'>) =>
  !e.disabled && !e.options?.length && (e.role === 'combobox' || !!e.picks || (e.expanded !== undefined && (e.role === 'textbox' || e.role === 'searchbox')));

/** A control of this pop-up (by the pop-up the page put it in, or its title) — never one of the page behind it. */
const popupHas = (top: DialogInfo, e: ElementInfo) => !!e.inBlockingPopup || (!!top.title && (e.inDialog === top.title || !!e.context?.includes(top.title)));

/** A pop-up form's own finishing button (Save, Create, Add…). */
const saveButtonIn = (top: DialogInfo, snap: PageSnapshot) => snap.elements.find((e) => e.role === 'button' && !e.disabled && popupHas(top, e) && SAVE_BUTTON.test(e.name.trim()));

export class CrawlRun {
  private readonly abort = new AbortController();
  /** Pop-up forms already read and filled (title and fields): another button opening one is only noted. */
  private readonly filledPopups = new Set<string>();
  /** A series of controls told apart by a number (calendar slots): the first one tried on each kind of page. */
  private readonly clickedKinds = new Map<string, string>();
  /** Pages written up so far (url | title). */
  private written = new Set<string>();
  private keepTimer: ReturnType<typeof setTimeout> | null = null;
  /** Pop-up forms already saved with test values (by title): once each. */
  private readonly savedForms = new Set<string>();
  /** The spending limit now (raised each time the user lets it spend more). */
  private spendCap = 0;
  private writingStopped = false;
  private readonly s: CrawlerSettings;
  private readonly browser: BrowserController;
  private state: CrawlState;
  private resolvers = new Map<string, (a: CrawlAnswer) => void>();
  private paused = false;
  private resumeWait: (() => void) | null = null;
  private stopping = false;
  private queue: Target[] = [];
  private seenUrls = new Set<string>();
  private templates = new Set<string>();
  /** Controls clicked anywhere and what they did — a menu on every page is tried once. */
  private clickedNames = new Map<string, string>();
  private skipAll = new Set<string>();
  /** Screens seen (title and headings without dates): one seen again is not a new page. */
  private screens = new Set<string>();
  /** On how many pages each control (by its label) was seen, of how many pages — the ones every page has are the site's own frame. */
  private labelPages = new Map<string, number>();
  private pagesWithControls = 0;
  /** What a control (not a table row's) did, the last time it was clicked anywhere. */
  private anyOutcome = new Map<string, string>();

  /**
   * A control of the site's frame — a header's or a sidebar's, on (nearly) every page: what it does was learned the
   * first time, and it is not clicked again on every page.
   */
  private siteWide(label: string): boolean {
    const n = this.labelPages.get(label.toLowerCase()) ?? 0;
    return n >= 2 && n >= this.pagesWithControls * 0.6;
  }

  /** The controls of the page being explored, by id: a pop-up's are the ones that were not there. */
  private pageIds = new Set<number>();
  /** Pop-ups still there after their page was opened again (a chat widget, a banner): part of that page. */
  private partOfPage = new Set<string>();
  /** Controls tried on one tab of a page (by the page, name, kind and place): the same on its other tabs. */
  private siblingClicks = new Map<string, { template: string; outcome: string }>();

  /** The kind of page this site signs in on (seen at the start). */
  private loginPage = '';
  /** Pages for the model to write up; null: no more pages. */
  private writeQueue: (PageCapture | null)[] = [];
  /** How each page was reached, for the site map. */
  private vias = new Map<string, string>();
  private writer: Promise<void> | null = null;
  private notes: string[] = [];
  private client: LlmClient | null = null;
  private model = '';
  private budget = 24_000;
  private signedInAt = Date.now();

  constructor(private readonly o: CrawlOptions) {
    this.s = { ...crawlerSettings(o.config.settings), ...(o.overrides ?? {}) };
    this.spendCap = this.s.spendLimit;
    this.browser = new BrowserController(o.windowId, o.tabId);
    // Its test values are its own: pages it typed into are left without asking.
    this.browser.leaveMode = 'always';
    this.state = {
      id: uid('crawl_'),
      phase: 'exploring',
      host: '',
      siteName: '',
      startUrl: o.startUrl,
      model: '',
      pagesDone: 0,
      limit: this.s.pageLimit,
      queued: 0,
      doing: 'Starting…',
      current: null,
      log: [],
      proposals: [],
      neverClick: [],
      pages: [],
      prompts: [],
      writing: { done: 0, total: 0 },
      spent: 0,
      captures: [],
      otherSites: [],
      startedAt: Date.now(),
      minutes: 0,
      timeLimit: this.s.timeLimit,
    };
  }

  // ---------- Time

  /** When exploring began, and how long it has waited for the user since (paused, or a question open). */
  private exploreStart = 0;
  private waitedMs = 0;

  private exploredMs(): number {
    return this.exploreStart ? Math.max(0, Date.now() - this.exploreStart - this.waitedMs) : 0;
  }

  /** The time limit is reached: exploring stops and what was learned is written. */
  private timeUp(): boolean {
    return this.s.timeLimit > 0 && this.exploredMs() >= this.s.timeLimit * 60_000;
  }

  private tick() {
    const minutes = Math.floor(this.exploredMs() / 60_000);
    if (minutes !== this.state.minutes) this.set({ minutes });
  }

  // ---------- Controls from the UI

  get snapshot(): CrawlState {
    return this.state;
  }

  pause() {
    if (this.state.phase !== 'exploring') return;
    this.paused = true;
    this.set({ phase: 'paused', doing: 'Paused — you can use the tab. Press Resume to carry on.' });
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.set({ phase: 'exploring' });
    this.resumeWait?.();
    this.resumeWait = null;
  }

  /** Stops exploring; what was seen is still written, then reviewed. */
  stop() {
    this.stopping = true;
    if (this.paused) this.resume();
    for (const p of this.state.prompts) this.answer(p.id, p.kind === 'approval' ? 'skip' : 'finish');
  }

  /** Stops everything; nothing more is written. */
  cancel() {
    this.stopping = true;
    this.abort.abort(new Error('cancelled'));
    for (const [id, r] of this.resolvers) {
      r('finish');
      this.resolvers.delete(id);
    }
    this.resumeWait?.();
    this.goWrite?.();
    this.set({ phase: 'cancelled', prompts: [], doing: 'Cancelled.' });
    void this.browser.setPresence(false);
  }

  answer(promptId: string, answer: CrawlAnswer) {
    const r = this.resolvers.get(promptId);
    if (!r) return;
    this.resolvers.delete(promptId);
    this.set({ prompts: this.state.prompts.filter((p) => p.id !== promptId) });
    r(answer);
  }

  /** The user's edits in the review. */
  setProposals(proposals: ProposedEntry[]) {
    this.set({ proposals });
  }

  setNeverClick(neverClick: string[]) {
    this.set({ neverClick });
  }

  // ---------- The run

  async start(): Promise<CrawlState> {
    // 1. Explore the whole site (and, only when the settings say so, write while exploring).
    return this.exploreThenWrite(() => this.exploreSite());
  }

  private async exploreThenWrite(exploring: () => Promise<void>): Promise<CrawlState> {
    try {
      await exploring();
    } catch (err) {
      if (this.abort.signal.aborted) return this.state;
      const message = err instanceof Error ? err.message : String(err);
      await this.browser.setPresence(false);
      this.set({ error: message, doing: message, prompts: [] });
      this.log(message, 'warn');
      if (!this.state.captures.length) {
        this.set({ phase: 'failed' });
        return this.state;
      }
    }
    if (this.abort.signal.aborted) return this.state;
    // 2. What was read is shown first; the model writes when the user says so.
    if (!this.s.writeWhileExploring) {
      await this.browser.setPresence(false);
      this.set({ phase: 'explored', current: null, prompts: [], doing: `Explored ${this.state.pagesDone} pages. Read what was seen, then write the knowledge base.` });
      this.log(`Explored ${this.state.pagesDone} pages — nothing written yet.`, 'ok');
      await new Promise<void>((resolve) => (this.goWrite = resolve));
      if (this.abort.signal.aborted) return this.state;
      this.writeQueue.push(...this.state.captures);
      this.writer = this.writeLoop();
      this.set({ writing: { done: 0, total: this.state.captures.length } });
    }
    return this.finishWriting();
  }

  /** 3. Write: the pages, then the site map and workflows; then the review. */
  private async finishWriting(): Promise<CrawlState> {
    try {
      this.set({ phase: 'writing', doing: 'Writing the knowledge…', current: null });
      this.writeQueue.push(null);
      await this.writer;
      if (this.abort.signal.aborted) return this.state;
      await this.writeSite();
      this.addCrawlRules();
      this.set({ phase: 'review', doing: 'Review what was learned, then save.', prompts: [] });
      this.log(`Done: ${this.state.pagesDone} pages, ${this.state.proposals.length} knowledge entries to review.`, 'ok');
    } catch (err) {
      if (this.abort.signal.aborted) return this.state;
      const message = err instanceof Error ? err.message : String(err);
      this.set({ phase: this.state.proposals.length ? 'review' : 'failed', error: message, doing: message, prompts: [] });
      this.log(message, 'warn');
    }
    return this.state;
  }

  /** After exploring: the user read what was seen and asks for the knowledge base to be written. */
  write() {
    this.goWrite?.();
    this.goWrite = null;
  }

  private goWrite: (() => void) | null = null;

  private async exploreSite() {
    {
      this.setupModel();
      let tab = await this.browser.currentTab();
      const start = this.o.startUrl.trim() ? normalizeUrl(withScheme(this.o.startUrl.trim())) : normalizeUrl(tab.url ?? '');
      if (!start) throw new Error('Open the website in this tab (or type its address) first.');
      const host = hostOf(start);
      this.set({ host, siteName: this.o.existing?.name || host, startUrl: start, model: this.model });
      this.log(`Learning ${host} with ${this.model}. Page limit ${this.state.limit}.`);
      if (normalizeUrl(tab.url ?? '') !== start) tab = await this.browser.navigate(start, this.abort.signal);
      await this.browser.setPresence(true);
      if (isLoginUrl(tab.url ?? '') || (await this.looksSignedOut())) {
        // This site's sign-in page, learned here: coming back to it later means the session ended.
        this.loginPage = templateOf(normalizeUrl(tab.url ?? '') ?? start);
        await this.waitForLogin(tab.url ?? start, true);
      }
      this.signedInAt = Date.now();
      this.enqueue({ url: normalizeUrl((await this.browser.currentTab()).url ?? start) ?? start });
      if (this.s.writeWhileExploring) this.writer = this.writeLoop();
      await this.explore();
      this.log(this.stopping ? 'Exploring stopped.' : 'Every page found has been visited.', 'ok');
      await this.browser.setPresence(false);
    }
  }

  private setupModel() {
    const { config, agent } = this.o;
    let provider: ProviderConfig | undefined;
    let model = '';
    if (this.s.providerId) provider = config.providers.find((p) => p.id === this.s.providerId);
    if (provider) model = this.s.model.trim() || provider.defaultModel.trim();
    else {
      const r = resolveProvider(agent, config, this.o.startUrl);
      provider = r.provider;
      model = this.s.model.trim() || r.model;
    }
    if (!model) throw new Error(`Choose which model to use with ${provider.name}.`);
    this.model = model;
    this.budget = budgetFor(contextWindowOf(provider));
    // Writing needs no thinking: it is off, which keeps the cost down.
    this.client = meteredClient(createClient({ ...provider, thinking: 'off' }), 'worker', () => '', (call) => {
      if (call.cost) this.set({ spent: this.state.spent + call.cost });
      void recordCall(call, this.state.host || 'crawl', this.state.id).catch(() => undefined);
    });
  }

  private async explore() {
    if (!this.exploreStart) this.exploreStart = Date.now();
    while (!this.stopping) {
      await this.gate();
      this.tick();
      if (this.timeUp()) {
        this.log(`Time limit reached (${this.s.timeLimit} min) — writing what was learned.`, 'ok');
        break;
      }
      const target = this.queue.shift();
      if (!target) {
        this.set({ queued: 0 });
        break;
      }
      const template = templateOf(target.url);
      if (this.templates.has(template)) {
        this.set({ queued: this.queue.length });
        continue;
      }
      // Kept with the crawl while it is read: opened again after a crash, this page is read again first.
      this.visiting = target;
      this.set({ queued: this.queue.length });
      if (!(await this.roomForPage())) break;
      this.templates.add(template);
      try {
        await this.visit(target);
      } catch (err) {
        if (this.abort.signal.aborted) return;
        this.log(`Could not read ${pathOf(target.url)}: ${err instanceof Error ? err.message : String(err)}`, 'warn');
      }
      this.visiting = null;
      this.keep(true);
    }
  }

  /** The calls to the server an action made, and what it answered: written into the page's knowledge (once each). */
  private noteApi(capture: PageCapture, lines: string[], by: string) {
    if (!lines.length) return;
    capture.api ??= [];
    for (const l of lines) {
      const line = `${by}: ${l}`;
      if (!capture.api.includes(line)) capture.api.push(line);
    }
    if (capture.api.length > 40) capture.api.splice(0, capture.api.length - 40);
  }

  /** The page being read now (kept with the crawl, so a crash doesn't lose it). */
  private visiting: Target | null = null;

  /** Where exploring is, for keeping with the crawl. */
  private exploreState(): ExploreState {
    return {
      queue: this.queue,
      visiting: this.visiting,
      seenUrls: [...this.seenUrls],
      templates: [...this.templates],
      clickedNames: [...this.clickedNames],
      skipAll: [...this.skipAll],
      screens: [...this.screens],
      labelPages: [...this.labelPages],
      pagesWithControls: this.pagesWithControls,
      anyOutcome: [...this.anyOutcome],
      siblingClicks: [...this.siblingClicks],
      clickedKinds: [...this.clickedKinds],
      filledPopups: [...this.filledPopups],
      savedForms: [...this.savedForms],
      partOfPage: [...this.partOfPage],
      loginPage: this.loginPage,
      limit: this.state.limit,
      usedMs: this.exploredMs(),
    };
  }

  /** Exploring as it was kept: carried on from there (the page being read then is read again). */
  private takeExploreState(e: ExploreState, captured: Set<string>) {
    const visiting = e.visiting;
    const templates = new Set(e.templates);
    // The page it was reading when it stopped, unless it was finished: back at the front of the queue.
    if (visiting && !captured.has(visiting.url)) templates.delete(templateOf(visiting.url));
    this.queue = visiting && !captured.has(visiting.url) ? [visiting, ...e.queue] : [...e.queue];
    this.seenUrls = new Set(e.seenUrls);
    this.templates = templates;
    this.clickedNames = new Map(e.clickedNames);
    this.skipAll = new Set(e.skipAll);
    this.screens = new Set(e.screens);
    this.labelPages = new Map(e.labelPages);
    this.pagesWithControls = e.pagesWithControls;
    this.anyOutcome = new Map(e.anyOutcome);
    this.siblingClicks = new Map(e.siblingClicks);
    for (const [k, v] of e.clickedKinds) this.clickedKinds.set(k, v);
    for (const f of e.filledPopups) this.filledPopups.add(f);
    for (const f of e.savedForms) this.savedForms.add(f);
    this.partOfPage = new Set(e.partOfPage);
    this.loginPage = e.loginPage;
    this.exploreStart = Date.now() - e.usedMs;
    this.waitedMs = 0;
    this.set({ limit: e.limit, queued: this.queue.length, minutes: Math.floor(e.usedMs / 60_000) });
  }

  /** Under the limit, or the user said “carry on”. */
  private async roomForPage(): Promise<boolean> {
    if (this.state.pagesDone < this.state.limit) return true;
    // Running on its own: the page limit is where it stops.
    const answer = this.s.unattended ? 'finish' : await this.ask({ kind: 'limit', count: this.state.pagesDone, more: this.s.extendBy });
    if (answer !== 'more') {
      this.log(`Stopped at the page limit (${this.state.pagesDone} pages).`);
      return false;
    }
    this.set({ limit: this.state.limit + this.s.extendBy });
    this.log(`Carrying on: ${this.s.extendBy} more pages (limit ${this.state.limit}).`);
    return true;
  }

  private async visit(target: Target): Promise<void> {
    this.set({ doing: `Opening ${pathOf(target.url)}`, current: { url: target.url, title: '' } });
    let tab = await this.browser.currentTab();
    if (normalizeUrl(tab.url ?? '') !== target.url) tab = await this.browser.navigate(target.url, this.abort.signal);
    await sleep(600, this.abort.signal);
    tab = await this.browser.currentTab();
    const url = normalizeUrl(tab.url ?? '') ?? target.url;
    if (!sameSite(url, this.state.host)) {
      this.log(`${pathOf(target.url)} goes to another site (${hostOf(url)}) — not followed.`);
      return;
    }
    if (await this.sessionGone(url, target.url)) {
      await this.waitForLogin(url, false);
      return this.visit(target);
    }
    if (url !== target.url) {
      // Redirected: the page it went to is the one read (once).
      const t = templateOf(url);
      if (this.templates.has(t) && t !== templateOf(target.url)) return;
      this.templates.add(t);
      this.seenUrls.add(url);
    }

    await this.waitForContent();
    // The whole page, not only what shows: scrolled to the end (the page and each box that scrolls — a sidebar, a
    // table), so lazy lists load and every row is seen; then read.
    const scrolled = await this.scrollThrough();
    const snap = await this.read();
    this.set({ current: { url, title: snap.title } });
    const capture = this.captureOf(snap, url, target.from);
    addScrolledText(capture, scrolled);
    this.screens.add(screenSignature(snap));
    this.recordPage(capture);
    await this.collectLinks(url, snap.title);
    // Then its fields, top to bottom: each one is scrolled to and filled where it is.
    this.pageIds = new Set(snap.elements.map((e) => e.id));
    // Not its search and filter boxes: many sites keep what is typed there, and a list filtered by a test value shows
    // no rows — their buttons (open, edit) are then never tried. What the boxes are is read all the same.
    await this.closeLeftOpen(url);
    await this.fillForms(snap, capture, undefined, isListFilter);
    // Test values typed into a search or filter box empty its list, and the rows' buttons go with it: the page is
    // opened again, clean, and read again for its clicks.
    let clickSnap = snap;
    if (capture.fields.some((f) => f.includes('test value typed'))) {
      await this.browser.navigate(url, this.abort.signal);
      await this.waitForContent(snap.elements.filter((e) => rowOf(e) > 0).length);
      clickSnap = await this.read().catch(() => snap);
      this.pageIds = new Set(clickSnap.elements.map((e) => e.id));
    }
    await this.tryClicks(clickSnap, capture, url);
    this.addCapture(capture);
  }

  /**
   * A page whose address loaded but whose content is still coming (a record fetched after the page opens shows
   * nothing but its shell at first): waited for — until the page goes quiet and has controls, up to ~10 s.
   */
  private async waitForContent(rowsBefore = 0) {
    await this.browser.send({ kind: 'settle', quietMs: 500, timeoutMs: 6000 }).catch(() => null);
    // The menus every page shares come first; a list's rows after their data arrives: done when the page's
    // controls stop changing between two reads.
    let last = '';
    for (let i = 0; i < 8; i++) {
      const snap = await this.read().catch(() => null);
      const now = snap ? snap.elements.filter((e) => CLICKABLE.has(e.role)).map((e) => labelOf(e)).join('|') : '';
      // Opened again after it was read: its table's rows are waited for too, as many as it had (or near).
      const rows = snap ? snap.elements.filter((e) => rowOf(e) > 0).length : 0;
      if (snap && now && now === last && rows >= rowsBefore * 0.8) return;
      last = now;
      await sleep(1000, this.abort.signal);
    }
  }

  /** What was read on a page, kept to show the user — and to write from (now, or after exploring). */
  private addCapture(c: PageCapture) {
    this.set({ captures: [...this.state.captures, c] });
    if (!this.s.writeWhileExploring) return;
    this.writeQueue.push(c);
    this.set({ writing: { ...this.state.writing, total: this.state.writing.total + 1 } });
  }

  private recordPage(c: PageCapture) {
    const page: CrawledPage = { url: c.url, title: c.title, template: c.template, at: Date.now() };
    if (c.from) this.vias.set(c.url, `${c.from.title || pathOf(c.from.url)} › ${c.from.via}`);
    this.set({ pagesDone: this.state.pagesDone + 1, pages: [...this.state.pages, page] });
    this.log(`Page ${this.state.pagesDone}: ${c.title || pathOf(c.url)}${c.screenOf ? ' (screen)' : ''}`);
  }

  private async read(): Promise<PageSnapshot> {
    return this.browser.send({ kind: 'snapshot', mode: 'content', maxElements: 400, maxTextChars: 14_000 });
  }

  /**
   * Scrolls the page and every box on it that scrolls (sidebar, table, panel) from top to bottom, in view of the
   * user, collecting the text each step shows — lists that draw only the rows on screen are read whole. Then puts
   * them back, with the selected item of a sidebar in view.
   */
  private async scrollThrough(popup = false): Promise<{ boxes: number; lines: string[] }> {
    this.set({ doing: popup ? 'Scrolling through the pop-up to read all of its form' : 'Scrolling through the page to read all of it' });
    const tab = await this.browser.currentTab();
    const res = await chrome.scripting
      .executeScript({
        target: { tabId: tab.id! },
        args: [popup],
        func: async (popupOnly: boolean) => {
          const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
          const root = document.scrollingElement ?? document.documentElement;
          // With a pop-up open: only what scrolls in it (its body, or the layer around it) — not the page behind.
          const shown = Array.from(document.querySelectorAll('dialog[open],[role=dialog],[role=alertdialog],[aria-modal=true],.modal.show,.modal.in,.ui-dialog')).filter((d) => d.getClientRects().length);
          const dialog = shown[shown.length - 1] ?? null;
          if (popupOnly && !dialog) return { boxes: 0, lines: [] };
          const scrolls = (he: HTMLElement) => he.clientHeight >= 60 && he.scrollHeight > he.clientHeight + 30 && /(auto|scroll|overlay)/.test(getComputedStyle(he).overflowY) && he.getClientRects().length > 0;
          const boxes: Element[] = [];
          if (!popupOnly && root.scrollHeight > innerHeight + 40) boxes.push(root);
          const pool = popupOnly ? [...Array.from(dialog!.querySelectorAll('*')), ...(() => { const up: Element[] = []; for (let e = dialog!.parentElement; e && e !== document.body; e = e.parentElement) up.push(e); return up; })()] : Array.from(document.querySelectorAll('body *'));
          // Every box that scrolls — boxes inside boxes too (a form section inside a scrolling main area).
          for (const el of pool) {
            if (boxes.length >= 14) break;
            if (scrolls(el as HTMLElement)) boxes.push(el);
          }
          const lines = new Set<string>();
          const grab = (el: Element) => {
            for (const l of ((el === root ? document.body : (el as HTMLElement)).innerText ?? '').split('\n')) {
              const t = l.replace(/\s+/g, ' ').trim();
              if (t && lines.size < 3000) lines.add(t.slice(0, 200));
            }
          };
          let steps = 0;
          for (const box of boxes) {
            const start = box.scrollTop;
            const step = Math.max(200, Math.round((box === root ? innerHeight : box.clientHeight) * 0.85));
            for (let y = 0; y < box.scrollHeight && steps < 80; y += step) {
              box.scrollTo({ top: y });
              steps++;
              // Slow enough to see: the user watches it read the whole page.
              await wait(600);
              grab(box);
            }
            box.scrollTo({ top: box === root ? 0 : start });
          }
          // A sidebar's selected item in view (where the user is).
          if (popupOnly) return { boxes: boxes.length, lines: [...lines] };
          const selected = document.querySelector(
            '[aria-current="page"], nav [aria-selected="true"], aside [aria-selected="true"], .ant-menu-item-selected, nav .active, aside .active, nav .selected, aside .selected, [class*="sidebar"] .active, [class*="sidebar"] .selected',
          );
          selected?.scrollIntoView({ block: 'center' });
          root.scrollTo({ top: 0 });
          await wait(200);
          return { boxes: boxes.length, lines: [...lines] };
        },
      })
      .catch(() => []);
    return (res[0]?.result as { boxes: number; lines: string[] } | undefined) ?? { boxes: 0, lines: [] };
  }

  private captureOf(snap: PageSnapshot, url: string, from?: Target['from'], screenOf?: string): PageCapture {
    const controls = snap.elements.slice(0, MAX_CONTROLS).map(controlLine).filter(Boolean);
    return {
      url,
      title: snap.title,
      template: templateOf(url) + (screenOf ? `#screen:${from?.via ?? ''}` : ''),
      ...(from ? { from } : {}),
      ...(screenOf ? { screenOf } : {}),
      headings: snap.headings,
      text: snap.text,
      controls,
      fields: [],
      clicks: [],
      dialogs: (snap.dialogs ?? []).map(dialogLine),
    };
  }

  /** Every link on the page (hidden menu items too), on this site: queued, breadth first. */
  private async collectLinks(pageUrl: string, pageTitle: string) {
    const tab = await this.browser.currentTab();
    const res = await chrome.scripting
      .executeScript({
        target: { tabId: tab.id! },
        func: () =>
          Array.from(document.querySelectorAll('a[href]'))
            .slice(0, 1500)
            .map((a) => ({ href: (a as HTMLAnchorElement).href, text: ((a as HTMLElement).innerText || a.getAttribute('aria-label') || a.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 80) })),
      })
      .catch(() => []);
    const links = (res[0]?.result ?? []) as { href: string; text: string }[];
    let added = 0;
    for (const l of links) {
      const url = normalizeUrl(l.href, pageUrl);
      if (!url || !sameSite(url, this.state.host) || isLogoutUrl(url)) continue;
      if (this.enqueue({ url, from: { url: pageUrl, title: pageTitle, via: l.text ? `link “${l.text}”` : `link to ${pathOf(url)}` } })) added++;
    }
    if (added) this.log(`Found ${added} new link${added === 1 ? '' : 's'}.`);
  }

  /** Queues an address not seen before, and of a kind of page not read yet. */
  private enqueue(t: Target): boolean {
    if (this.seenUrls.has(t.url)) return false;
    this.seenUrls.add(t.url);
    if (this.templates.has(templateOf(t.url)) || this.queue.some((q) => templateOf(q.url) === templateOf(t.url))) return false;
    this.queue.push(t);
    this.set({ queued: this.queue.length });
    return true;
  }

  /**
   * A form's fields, top to bottom, every one filled where it is: text gets a test value, a dropdown is opened, its
   * choices read and a real one chosen, a date gets a test date (typed, or picked in its calendar), and — in a pop-up
   * form — a tick box is ticked, a switch switched on and each group of radio buttons given a choice. `readOnly` fields
   * (a list's search and filters) are read, never filled (see visit()). `popup`: the title of the pop-up being filled
   * ('' or undefined: the page) — a pop-up that a field opens over it is read and closed before the next field, so
   * nothing is typed into a form something else covers.
   */
  private async fillForms(snap: PageSnapshot, capture: PageCapture, only?: (e: ElementInfo) => boolean, readOnly?: (e: ElementInfo) => boolean, popup?: string, values?: Map<number, string>) {
    let filled = 0;
    let dropdowns = 0;
    const radioGroups = new Set<string>();
    for (const el of snap.elements) {
      if (filled >= MAX_FIELDS || this.stopping) break;
      if (only && !only(el)) continue;
      const fill = !readOnly?.(el) && !el.disabled && !el.readonly;
      const label = el.label || el.name || el.placeholder || el.role;
      const required = `${el.required ? ' (required)' : ''}${el.hint ? ` (help: ${el.hint})` : ''}`;
      let acted = false;
      // Tick boxes, switches and radio buttons: only in a pop-up form (on a page they often save at once — settings,
      // a list's row selection), and not a table's “select all”.
      if (el.role === 'checkbox' || el.role === 'switch' || el.role === 'radio') {
        if (fill && popup !== undefined && !rowOf(el) && !/select all/i.test(label)) {
          const group = `${el.context ?? ''}`;
          const tick = el.role === 'radio' ? !radioGroups.has(group) && !snap.elements.some((r) => r.role === 'radio' && r.checked && `${r.context ?? ''}` === group) : !el.checked;
          if (el.role === 'radio') radioGroups.add(group);
          if (tick) {
            await this.gate();
            this.set({ doing: `${el.role === 'radio' ? 'Choosing' : 'Ticking'} “${label}”` });
            const ok = await this.browser.send({ kind: 'click', id: el.id, highlight: this.o.config.settings.highlightActions }).then(() => true).catch(() => false);
            capture.fields.push(`${el.role} “${label}”${required} — ${ok ? (el.role === 'radio' ? 'test choice made' : 'ticked as a test') : 'could not be ticked'}`);
            if (ok) (filled++, (acted = true));
          } else capture.fields.push(`${el.role} “${label}”${required}${el.checked ? ' — on' : ''}`);
        } else capture.fields.push(`${el.role} “${label}”${required}${el.checked ? ' — on' : ''}`);
        if (acted) await this.closeStray(popup, capture, `“${label}”`);
        continue;
      }
      // Dates: typed the way the field shows it (“DD/MM/YYYY”), or picked in the calendar it opens.
      if (isDateField(el)) {
        if (!fill || (el.value && el.value.trim())) {
          capture.fields.push(`date “${label}”${el.placeholder ? ` (${el.placeholder})` : ''}${required}${el.value ? ` — shows ${el.value}` : ''}`);
          continue;
        }
        await this.gate();
        const set = await this.fillDate(el).catch(() => '');
        capture.fields.push(`date “${label}”${el.placeholder ? ` (${el.placeholder})` : ''}${required} — ${set ? `test date set: ${set}` : 'could not set a date'}`);
        filled++;
        await this.closeStray(popup, capture, `“${label}”`);
        continue;
      }
      // Times (a booking's start and end): typed as 10:30, or picked in the list the field opens. A list-like time
      // field (a select, a searchable one) goes on below, where one of its choices is chosen.
      if (isTimeField(el) && !el.picks && el.tag !== 'select' && !el.options?.length) {
        if (!fill || (el.value && el.value.trim())) {
          capture.fields.push(`time “${label}”${el.placeholder ? ` (${el.placeholder})` : ''}${required}${el.value ? ` — shows ${el.value}` : ''}`);
          continue;
        }
        await this.gate();
        const set = await this.fillTime(el).catch(() => '');
        capture.fields.push(`time “${label}”${el.placeholder ? ` (${el.placeholder})` : ''}${required} — ${set ? `test time set: ${set}` : 'could not set a time'}`);
        filled++;
        await this.closeStray(popup, capture, `“${label}”`);
        continue;
      }
      const value = fill ? (values?.get(el.id) ?? dummyFor(el, this.s)) : null;
      if (value === null) {
        let options = el.options ?? [];
        if (!options.length && isDropdown(el) && dropdowns < MAX_DROPDOWNS && !this.stopping) {
          dropdowns++;
          options = await this.optionsOf(el).catch(() => []);
        }
        let chosen = '';
        let failed = '';
        // A form's dropdown: a real choice is chosen (not in a list's filter).
        if (fill && options.length && (isDropdown(el) || el.role === 'combobox' || el.tag === 'select')) {
          // Another than the one it shows, so choosing is seen to work (“Prefer not to say” → “Male”).
          const pick = options.find((o) => !PLACEHOLDER_CHOICE.test(o.trim()) && o.trim() !== (el.value ?? '').trim()) ?? (hasChoice(el) ? '' : undefined);
          if (pick) {
            await this.gate();
            this.set({ doing: `Choosing “${pick}” in “${label}”` });
            const choose = (id: number) => this.browser.send({ kind: 'select', id, option: pick, highlight: this.o.config.settings.highlightActions }).then((r) => r.selected || pick);
            chosen = await choose(el.id).catch(async (err) => {
              const id = await this.idFor(el).catch(() => null);
              if (id !== null && id !== el.id) return choose(id).catch((e2) => ((failed = e2 instanceof Error ? e2.message : String(e2)), ''));
              failed = err instanceof Error ? err.message : String(err);
              return '';
            });
            if (chosen) (filled++, (acted = true));
          }
        }
        if (['combobox', 'select'].includes(el.role) || el.type === 'date' || options.length)
          capture.fields.push(`${el.role === 'textbox' || el.role === 'button' ? (options.length ? 'dropdown' : el.role) : el.role} “${label}”${options.length ? ` options: ${options.slice(0, 25).join(', ')}${options.length > 25 ? ` (+${options.length - 25} more)` : ''}` : ''}${required}${chosen ? ` — test value chosen: ${chosen}` : failed ? ` — could not choose one (${failed.slice(0, 120)})` : ''}`);
        if (acted) await this.closeStray(popup, capture, `“${label}”`);
        continue;
      }
      await this.gate();
      try {
        this.set({ doing: `Typing a test value into “${label}”` });
        await this.browser.send({ kind: 'type', id: el.id, text: value, clear: false, highlight: this.o.config.settings.highlightActions });
        capture.fields.push(`${el.type === 'password' ? 'password' : el.role} “${label}”${required} — test value typed: ${el.type === 'password' ? '••••' : value}`);
        filled++;
        await this.closeStray(popup, capture, `“${label}”`);
      } catch {
        capture.fields.push(`${el.role} “${label}” (could not type into it)`);
      }
    }
  }

  /**
   * A pop-up a field opened on top of the form being filled (a search drawer, a confirm) — or, filling the page, any
   * pop-up: read, noted, and closed (its ×, Close, or Escape), so the next field is filled in the form, not under it.
   */
  private async closeStray(popup: string | undefined, capture: PageCapture, after: string) {
    const { dialogs } = await this.browser.send({ kind: 'dialogs', waitMs: 150 }).catch(() => ({ dialogs: [] as DialogInfo[] }));
    if (!dialogs.length) return;
    const top = dialogs.find((d) => d.onTop) ?? dialogs[dialogs.length - 1];
    if (popup && top.title === popup) return;
    if (popup === '' || popup === undefined ? false : !dialogs.some((d) => d.title === popup)) return; // the form itself closed: nothing to do here
    capture.dialogs.push(`${after} opens the pop-up “${top.title || 'untitled'}” on top of the form: ${(top.fullText ?? top.text ?? '').replace(/\s+/g, ' ').slice(0, 400)}`);
    this.set({ doing: `Closing “${top.title || 'a pop-up'}” that opened over the form` });
    if (top.close) await this.browser.send({ kind: 'click', id: top.close.id, highlight: false }).catch(() => undefined);
    else await this.browser.send({ kind: 'key', key: 'Escape' }).catch(() => undefined);
    await sleep(350, this.abort.signal);
  }

  /**
   * A test date in a date field: typed in the field's own format (its placeholder, or a native date input's), and —
   * when typing leaves it empty (a field that only takes picks) — picked in the calendar it opens: a day, and for a
   * range two days. A birth date gets a date long past; others today's month. Returns what the field shows after.
   */
  /**
   * A test time in a time field: typed (10:30, an end 11:00) — and when typing leaves it empty (a field that only
   * takes picks), the list of times it opens is read and one chosen (that time, else the first one offered).
   */
  private async fillTime(el: ElementInfo): Promise<string> {
    const label = el.label || el.name || el.placeholder || 'time';
    const want = timeFor(el);
    this.set({ doing: `Setting a test time in “${label}”` });
    await this.browser.send({ kind: 'type', id: el.id, text: want, clear: true, highlight: this.o.config.settings.highlightActions }).catch(() => undefined);
    await this.browser.send({ kind: 'key', key: 'Tab', id: el.id }).catch(() => undefined);
    await sleep(250, this.abort.signal);
    let shown = (await this.browser.send({ kind: 'fieldText', id: el.id }).catch(() => ({ value: '' }))).value.trim();
    if (shown) return shown;
    await this.browser.send({ kind: 'click', id: el.id, highlight: this.o.config.settings.highlightActions }).catch(() => undefined);
    await sleep(400, this.abort.signal);
    const list = await this.read().catch(() => null);
    const times = (list?.elements ?? []).filter(
      (e) => e.id !== el.id && !e.disabled && ['option', 'button', 'gridcell', 'clickable', 'menuitem', 'listitem'].includes(e.role) && /^\s*\d{1,2}[:.]\d{2}\b/.test(e.name),
    );
    const hm = want.slice(0, 5);
    const pick = times.find((e) => e.name.trim().startsWith(hm) || e.name.trim().startsWith(hm.replace(/^0/, ''))) ?? times[0];
    if (pick) {
      await this.browser.send({ kind: 'click', id: pick.id, highlight: this.o.config.settings.highlightActions }).catch(() => undefined);
      await sleep(300, this.abort.signal);
    }
    await this.browser.send({ kind: 'key', key: 'Tab', id: el.id }).catch(() => undefined);
    shown = (await this.browser.send({ kind: 'fieldText', id: el.id }).catch(() => ({ value: '' }))).value.trim();
    return shown;
  }

  private async fillDate(el: ElementInfo): Promise<string> {
    const label = el.label || el.name || el.placeholder || 'date';
    const range = isDateRange(el);
    const birth = /birth|dob|born/i.test(`${el.name} ${el.label ?? ''}`);
    const now = new Date();
    const day = (offset: number) => new Date(birth ? 1990 : now.getFullYear(), birth ? 4 : now.getMonth(), 15 + offset);
    this.set({ doing: `Setting a test date in “${label}”` });
    const text = range ? `${formatDate(day(0), el)} – ${formatDate(day(5), el)}` : formatDate(day(0), el);
    await this.browser.send({ kind: 'type', id: el.id, text, clear: true, highlight: this.o.config.settings.highlightActions }).catch(() => undefined);
    await this.browser.send({ kind: 'key', key: 'Tab', id: el.id }).catch(() => undefined);
    await sleep(250, this.abort.signal);
    let shown = (await this.browser.send({ kind: 'fieldText', id: el.id }).catch(() => ({ value: '' }))).value.trim();
    if (shown) return shown;
    // Only picked in its calendar: opened, and a day (two for a range) clicked.
    await this.browser.send({ kind: 'click', id: el.id, highlight: this.o.config.settings.highlightActions }).catch(() => undefined);
    await sleep(400, this.abort.signal);
    for (const d of range ? ['15', '20'] : ['15']) {
      const cal = await this.read().catch(() => null);
      const cell = cal?.elements.find((e) => (e.role === 'button' || e.role === 'gridcell' || e.role === 'clickable') && !e.disabled && (e.name.trim() === d || new RegExp(`(^|\\D)${d}(\\D|$)`).test(e.name) && /\d{4}|january|february|march|april|may|june|july|august|september|october|november|december/i.test(e.name)));
      if (!cell) break;
      await this.browser.send({ kind: 'click', id: cell.id, highlight: this.o.config.settings.highlightActions }).catch(() => undefined);
      await sleep(300, this.abort.signal);
    }
    await this.browser.send({ kind: 'key', key: 'Tab', id: el.id }).catch(() => undefined);
    shown = (await this.browser.send({ kind: 'fieldText', id: el.id }).catch(() => ({ value: '' }))).value.trim();
    return shown;
  }

  /**
   * Clicks the page's controls one by one (not links — those are visited), to learn what each does. Icons count too,
   * named or not; the first row of a table or grid is tried (its icons — edit, view, delete — act the same on every
   * row), and the page's own content goes before the menus and toolbars every page shares.
   */
  private async tryClicks(snap: PageSnapshot, capture: PageCapture, pageUrl: string) {
    const labels = new Set<string>();
    const candidates = snap.elements
      .filter((e) => {
        if (!CLICKABLE.has(e.role) || e.disabled) return false;
        if (e.role === 'link' && e.href && e.href !== '#' && !e.href.startsWith('#')) return false; // visited as a page
        const row = rowOf(e);
        if (row > 1) return false; // one row of a table shows what every row does
        const label = labelOf(e);
        if (!label || label.length > 70 || labels.has(label.toLowerCase())) return false;
        labels.add(label.toLowerCase());
        return true;
      })
      // A table's first row (its icons) first, then the rest of the page in order.
      .sort((a, b) => +(rowOf(b) === 1) - +(rowOf(a) === 1));
    // Which controls every page has (a header's buttons, a sidebar's): counted per page.
    this.pagesWithControls++;
    for (const l of labels) this.labelPages.set(l, (this.labelPages.get(l) ?? 0) + 1);
    let clicks = 0;
    for (const el of candidates) {
      if (clicks >= this.s.clicksPerPage || this.stopping || this.timeUp()) break;
      await this.gate();
      const label = labelOf(el);
      // A run of the same control told apart only by a time, date or number (a calendar's “Book 12:00 in …”, “Book
      // 12:15 in …”, a list of days): one of them is tried — the rest do the same.
      const kind = sameKindOf(label);
      if (kind) {
        const first = this.clickedKinds.get(`${capture.template}|${kind}`);
        if (first) {
          capture.clicks.push(`“${label}”: like “${first}” (one of a series — not tried again)`);
          continue;
        }
        this.clickedKinds.set(`${capture.template}|${kind}`, label);
      }
      // A menu, a sidebar item, a toolbar button: what it does was learned on the first page that has it. A row's
      // icon or a page's own button is tried on every kind of page — the same name does other things there.
      const key = `${capture.template}|${label.toLowerCase()}`;
      const shared = `*${label.toLowerCase()}`;
      const known =
        (rowOf(el) ? undefined : this.clickedNames.get(shared) ?? (this.siteWide(label) ? this.anyOutcome.get(label.toLowerCase()) : undefined)) ?? this.clickedNames.get(key);
      if (known) {
        capture.clicks.push(`“${label}”: ${known} (seen on another page)`);
        continue;
      }
      // Another tab of the same page (“?tab=insight” after “?tab=overview”): its header's buttons (Edit tags, Edit
      // practice member) and its row of tabs were tried on the first tab — not again on every one.
      const sibling = `${pageOfScreen(pageUrl)}|${label.toLowerCase()}|${el.role}|${el.context ?? ''}`;
      const onSibling = this.siblingClicks.get(sibling);
      if (onSibling && onSibling.template !== capture.template) {
        capture.clicks.push(`“${label}”: ${onSibling.outcome} (the same on the other tabs of this page)`);
        continue;
      }
      const why = dangerOf(el, this.s.askWords);
      if (why) {
        if (this.skipAll.has(why)) {
          capture.clicks.push(`“${label}”: ${why} — not clicked (you said skip these)`);
          continue;
        }
        // Running on its own: never clicked, never asked about.
        const answer = this.s.unattended ? 'skip' : await this.ask({ kind: 'approval', name: label, why, page: capture.title || pathOf(pageUrl) });
        if (answer === 'skip-all') this.skipAll.add(why);
        if (answer !== 'allow') {
          capture.clicks.push(`“${label}”: ${why} — not clicked (needs the user's OK)`);
          this.clickedNames.set(key, `${why} — not clicked`);
          if (!rowOf(el)) this.clickedNames.set(shared, `${why} — not clicked`);
          continue;
        }
      }
      clicks++;
      const outcome = await this.clickAndSee(el, capture, pageUrl).catch((err) => `could not click it (${err instanceof Error ? err.message : String(err)})`);
      capture.clicks.push(`“${label}”: ${outcome}`);
      if (!this.siblingClicks.has(sibling)) this.siblingClicks.set(sibling, { template: capture.template, outcome });
      if (!rowOf(el) && sharedOutcome(outcome)) this.clickedNames.set(shared, outcome);
      if (!rowOf(el)) this.anyOutcome.set(label.toLowerCase(), outcome);
      this.clickedNames.set(key, outcome);
      if (this.abort.signal.aborted) return;
    }
  }

  /** One click and what it did; puts the page back as it was (back to its address, pop-up closed). */
  private async clickAndSee(el: ElementInfo, capture: PageCapture, pageUrl: string, depth = 0): Promise<string> {
    this.set({ doing: `Clicking “${labelOf(el)}”` });
    const before = await this.browser.currentTab();
    const watcher = await this.browser.watchNewTabs();
    let res: Partial<ClickResult> = {};
    try {
      // Nothing on the page behind a drawer or pop-up still open: it is closed first (the page opened again when it
      // won't close). One that is part of the page (still there after the page opened again) is left as it is.
      await this.closeLeftOpen(pageUrl);
      let id = await this.idFor(el);
      if (id === null) {
        // An earlier click left the page showing something else (another tab, a filtered list): opened again, as it was.
        await this.browser.navigate(pageUrl, this.abort.signal);
        await this.waitForContent();
        id = await this.idFor(el);
      }
      if (id === null) return 'gone from the page';
      try {
        res = await this.browser.send({ kind: 'click', id, highlight: this.o.config.settings.highlightActions });
      } catch (err) {
        if (!(err instanceof PageError && err.code === 'navigating')) throw err;
      }
      const settled = await this.browser.settleAfterAction(before.url ?? pageUrl, this.abort.signal);
      this.noteApi(capture, settled.api ?? [], `clicking “${labelOf(el)}”`);
      const opened = watcher.opened();
      if (opened) return await this.newTab(opened, el.name);
      if (res.opensNewTab) {
        const url = normalizeUrl(res.opensNewTab, pageUrl);
        if (url && sameSite(url, this.state.host)) {
          this.enqueue({ url, from: { url: pageUrl, title: capture.title, via: `“${el.name}”` } });
          return `opens ${pathOf(url)} in a new tab`;
        }
        if (url) this.addOtherSite({ host: hostOf(url), url, tabId: null });
        return `opens another site in a new tab (${url ? hostOf(url) : 'unknown'})`;
      }
      if (settled.navigated) {
        const url = normalizeUrl(settled.url) ?? settled.url;
        let outcome: string;
        if (!sameSite(url, this.state.host)) outcome = `goes to another site (${hostOf(url)}) — not followed`;
        else if (isLoginUrl(url)) outcome = 'goes to the sign-in page (signs out)';
        else {
          this.enqueue({ url, from: { url: pageUrl, title: capture.title, via: `“${el.name}”` } });
          outcome = `opens the page ${pathOf(url)}${settled.title ? ` (“${settled.title}”)` : ''}`;
        }
        if (isLoginUrl(url)) {
          await this.waitForLogin(url, false);
        }
        await this.browser.navigate(pageUrl, this.abort.signal);
        await sleep(400, this.abort.signal);
        return outcome;
      }
      // A pop-up?
      const { dialogs } = await this.browser.send({ kind: 'dialogs', waitMs: 400 }).catch(() => ({ dialogs: [] as DialogInfo[] }));
      const top = dialogs.find((d) => d.onTop) ?? dialogs[dialogs.length - 1];
      if (top) {
        // The same form, opened by another button (Add NHI, Edit — one “Edit practice member” form): read and filled
        // once; here only noted, and closed.
        // By its title and first fields only: filling a form adds fields to it (ACC chosen → its ACC fields), and
        // the same form opened again then looked like another one — and was filled again, a minute each time.
        const formKey = `${top.title}|${(top.form ?? []).slice(0, 4).map((l) => l.split(' — ')[0]).join(',')}`;
        if (top.title && top.form?.length && this.filledPopups.has(formKey)) {
          await this.closePopup(top, pageUrl);
          return `opens the pop-up “${top.title}” (the same form as before — its fields are described there)`;
        }
        if (top.title && top.form?.length) this.filledPopups.add(formKey);
        capture.dialogs.push(dialogLine(top));
        // Its whole form, scrolled through in view (fields below the fold too); then filled with test values to see
        // what it asks — never submitted.
        const scrolled = await this.scrollThrough(true);
        if (scrolled.lines.length) capture.dialogs.push(`“${top.title || 'Pop-up'}” — all of it, scrolled: ${scrolled.lines.join(' | ').slice(0, 2500)}`);
        const inside = await this.read().catch(() => null);
        const behind = new Set(capture.controls);
        // Its fields: what the page did not have before it opened (a drawer's fields carry no title of it).
        // The pop-up's own fields — not the page's search and filter boxes behind it (see visit()).
        // When the page marks its pop-ups (a dialog, a drawer), only what is inside this one is touched — never a
        // row's checkbox or a filter of the page behind it (a Stations table's rows were ticked behind its Edit drawer).
        const marked = !!inside?.elements.some((e) => e.inDialog);
        const ownField = marked
          ? (e: ElementInfo) => !!e.inDialog && (!top.title || e.inDialog === top.title)
          : (e: ElementInfo) => !!e.inBlockingPopup || (!!top.title && !!e.context?.includes(top.title)) || (!isListFilter(e) && !rowOf(e) && (!this.pageIds.has(e.id) || (!top.title && !behind.has(controlLine(e)))));
        // On a test site (the user turned this on): saved empty first — what it says then is what it requires.
        if (this.s.trySaving && inside && depth === 0 && (await this.tryEmptySave(top, inside, capture))) {
          return `opens the pop-up “${top.title || 'untitled'}”; it saves even when empty`;
        }
        if (inside) await this.fillForms(inside, capture, ownField, undefined, top.title || UNTITLED);
        const saved = this.s.trySaving && inside && depth === 0 ? await this.trySave(top, inside, capture) : null;
        if (saved) capture.dialogs.push(saved);
        if (saved?.includes('it closed')) return `opens the pop-up “${top.title || 'untitled'}”; saving it with test values worked`;
        await this.closePopup(top, pageUrl);
        return `opens the pop-up “${top.title || 'untitled'}”${top.form?.length ? ` with fields: ${top.form.slice(0, 10).join('; ')}` : ''}`;
      }
      if (res.menu?.length) {
        const items = res.menu.map((m) => m.name).filter(Boolean);
        if (depth === 0) await this.tryMenu(el, res.menu, capture, pageUrl);
        await this.browser.send({ kind: 'key', key: 'Escape' }).catch(() => undefined);
        return `opens a menu: ${items.slice(0, 15).map((i) => `“${i}”`).join(', ')}`;
      }
      // Something else changed on the page: a new screen without an address of its own (a tab, a view)? Not a
      // sidebar folding, nor the next week or page of the same list — and a screen seen before is not new.
      const label = labelOf(el);
      const after = await this.read().catch(() => null);
      if (after && !isSameScreen(label, this.s.sameScreenWords) && differs(after, capture)) {
        const sig = screenSignature(after);
        if (this.screens.has(sig)) return `shows the “${after.headings[0] ?? label}” screen`;
        this.screens.add(sig);
        if (depth === 0 && (await this.roomForPage())) {
          const screen = this.captureOf(after, pageUrl, { url: pageUrl, title: capture.title, via: `“${label}”` }, pageUrl);
          screen.title = `${capture.title || pathOf(pageUrl)} › ${label}`;
          this.recordPage(screen);
          this.addCapture(screen);
        }
        return `shows a new screen: ${after.headings.slice(0, 4).join(', ') || 'the content changes'}`;
      }
      if (after && isSameScreen(label, this.s.sameScreenWords)) return `changes what the list or calendar shows (${after.headings.slice(0, 2).join(', ') || 'same page'})`;
      const added = settled.effect?.added ?? [];
      return added.length ? `shows: ${added.slice(0, 4).join(' | ')}` : 'no visible change';
    } finally {
      watcher.stop();
    }
  }

  /** A menu's items that are not links: each one tried (links are visited as pages anyway). */
  private async tryMenu(trigger: ElementInfo, items: ElementInfo[], capture: PageCapture, pageUrl: string) {
    for (const item of items.slice(0, 10)) {
      if (this.stopping || !item.name?.trim()) continue;
      if (item.href && !item.href.startsWith('#')) continue;
      const key = `${trigger.name} › ${item.name}`.toLowerCase();
      if (this.clickedNames.has(key)) continue;
      const why = dangerOf(item, this.s.askWords);
      if (why) {
        capture.clicks.push(`“${trigger.name} › ${item.name}”: ${why} — not clicked`);
        continue;
      }
      await this.gate();
      const shown = await this.browser.send({ kind: 'menuPath', path: [trigger.name, item.name], highlight: this.o.config.settings.highlightActions }).catch(() => null);
      const reached = shown?.item;
      if (!reached) continue;
      const outcome = await this.clickAndSee(reached, capture, pageUrl, 1).catch(() => 'could not click it');
      this.clickedNames.set(key, outcome);
      capture.clicks.push(`“${trigger.name} › ${item.name}”: ${outcome}`);
    }
  }

  /**
   * A dropdown's choices: it is opened, the options that appear are read, and it is closed again (nothing chosen).
   * Custom dropdowns (a text box that opens a list) show their options only while open.
   */
  private async optionsOf(el: ElementInfo): Promise<string[]> {
    // The list the field points at is often in the page already (hidden): read as it is, nothing opened or re-drawn.
    const kept = await this.browser.send({ kind: 'choices', id: el.id }).catch(() => ({ options: [] as string[] }));
    if (kept.options.length) return kept.options;
    this.set({ doing: `Opening “${labelOf(el) || el.label || el.role}” to read its choices` });
    await this.browser.send({ kind: 'click', id: el.id, highlight: this.o.config.settings.highlightActions });
    await sleep(450, this.abort.signal);
    const { options } = await this.browser.send({ kind: 'choices', id: el.id }).catch(() => ({ options: [] as string[] }));
    // Closed again, nothing chosen: Tab moves on, and a list closes when its field loses focus. (Escape would close
    // the pop-up around it when the list did not open.)
    await this.browser.send({ kind: 'key', key: 'Tab', id: el.id }).catch(() => undefined);
    await sleep(200, this.abort.signal);
    return options;
  }

  /** The element's id now — the page may have re-drawn since it was read. */
  private async idFor(el: ElementInfo): Promise<number | null> {
    try {
      const r = await this.browser.send({ kind: 'describe', id: el.id });
      if (r.name === el.name || (!el.name && r.role === el.role)) return el.id;
    } catch {
      /* stale: look it up by its name */
    }
    if (el.name.trim()) {
      const found = await this.browser.send({ kind: 'find', query: el.name, limit: 5 }).catch(() => null);
      const same = found?.matches.find((m) => m.name.toLowerCase() === el.name.toLowerCase() && m.role === el.role) ?? found?.matches.find((m) => m.name.toLowerCase() === el.name.toLowerCase());
      if (same) return same.id;
    }
    // Not by its name (an icon with none, a name the page re-drew): the page read again, the same control in the same row.
    const now = await this.read().catch(() => null);
    const label = labelOf(el);
    const row = rowOf(el);
    return now?.elements.find((e) => e.role === el.role && rowOf(e) === row && labelOf(e) === label)?.id ?? null;
  }

  /** The user's answer, per form: may it be saved — empty, then with test values — to learn what it requires? */
  private readonly saveAnswers = new Map<string, boolean>();

  /**
   * Asked once per form (one question covers saving it empty and with test values). Never for a form that edits a
   * record already there, or whose save reaches the world (a booking, a payment, a message) — and never when it runs
   * on its own.
   */
  private async mayTrySaving(top: DialogInfo, buttonName: string, capture: PageCapture): Promise<boolean> {
    if (!top.title || EDIT_FORM.test(top.title) || REAL_EFFECT_FORM.test(`${top.title} ${top.text ?? ''}`.slice(0, 300)) || this.s.unattended) return false;
    const known = this.saveAnswers.get(top.title);
    if (known !== undefined) return known;
    const answer = await this.ask({ kind: 'approval', name: buttonName, why: 'saves this form — empty first, then with test values — to learn which fields it requires and the messages it shows (test sites only)', page: top.title || capture.title });
    this.saveAnswers.set(top.title, answer === 'allow');
    return answer === 'allow';
  }

  /**
   * Presses a new form's save button before anything is typed in it: what it says then — the fields it marks
   * required, its messages, what the server refuses — are the form's requirements, as the site states them.
   * Returns true when the form closed (it saved even empty: the form is gone, nothing more to fill).
   */
  private async tryEmptySave(top: DialogInfo, inside: PageSnapshot, capture: PageCapture): Promise<boolean> {
    const filled = (top.form ?? []).filter((l) => /— [^:]+: “/.test(l) && !/can’t be changed/.test(l)).length;
    if (filled >= 3) return false;
    const button = saveButtonIn(top, inside);
    if (!button) return false;
    const key = `${top.title}|empty`;
    if (this.savedForms.has(key)) return false;
    this.savedForms.add(key);
    if (!(await this.mayTrySaving(top, button.name, capture))) return false;
    this.set({ doing: `Saving “${top.title}” empty, to see which fields it requires` });
    await this.browser.send({ kind: 'click', id: button.id, highlight: this.o.config.settings.highlightActions }).catch(() => undefined);
    const settled = await this.browser.send({ kind: 'settle', quietMs: 600, timeoutMs: 7000 }).catch(() => null);
    const calls = await this.browser.apiCallsSince().catch(() => []);
    this.noteApi(capture, calls.map(describeCall), `saving “${top.title}” empty`);
    const { dialogs } = await this.browser.send({ kind: 'dialogs', waitMs: 400 }).catch(() => ({ dialogs: [] as DialogInfo[] }));
    const still = dialogs.find((d) => d.title === top.title);
    if (!still) {
      capture.dialogs.push(`Saving “${top.title}” empty (“${button.name}”): it closed — it saved with nothing filled in (a blank test record was added). Nothing in it is required.`);
      return true;
    }
    const found = await this.browser.send({ kind: 'formErrors', scope: top.title }).catch(() => ({ fields: [], messages: [] as string[] }));
    const before = new Set((top.fullText ?? top.text ?? '').split('\n').map((l) => l.trim()));
    const said = (still.fullText ?? still.text ?? '').split('\n').map((l) => l.trim()).filter((l) => l && !before.has(l) && l.length < 200);
    const appeared = (settled?.effect?.added ?? []).map((t) => t.trim()).filter((t) => t && t.length < 300 && ERROR_WORDS.test(t));
    const reasons = [
      ...found.fields.map((f) => `“${f.label || 'a field'}”: ${f.error}`),
      ...found.messages,
      ...said.filter((l) => ERROR_WORDS.test(l)),
      ...appeared,
      ...calls.filter((c) => !c.ok).map((c) => `the server: ${c.answer}`),
    ];
    capture.dialogs.push(`Saving “${top.title}” empty (“${button.name}”): it stayed open${reasons.length ? ` — it said: ${[...new Set(reasons)].slice(0, 15).join(' | ')}` : ' — no message shown'}.`);
    return false;
  }

  /**
   * Presses a pop-up form's save button with the test values in it, to learn what it requires — and when the form
   * refuses, reads why (each field's error under it, the form's message, a notification), fixes what it said (a
   * required field filled, a wrong format replaced by the form's own example, a value already taken made unique, a
   * colour given as a colour code) and saves again, up to three times — the form is learned through to a save, not
   * given up at its first error. Test sites only (the user turned this on); each form is asked about once.
   */
  private async trySave(top: DialogInfo, inside: PageSnapshot, capture: PageCapture): Promise<string | null> {
    // Only a form that makes something new: one that edits a record already there (its title says so, or it opened
    // filled in with the record's values) is never saved with test values — that would overwrite real data.
    if (!top.title || EDIT_FORM.test(top.title)) return null;
    // Nor one whose save reaches the world: a booking, a payment or invoice, a message, e-mail, SMS or invitation sent.
    if (REAL_EFFECT_FORM.test(`${top.title} ${top.text ?? ''}`.slice(0, 300))) return null;
    const filled = (top.form ?? []).filter((l) => /— [^:]+: “/.test(l) && !/can’t be changed/.test(l)).length;
    if (filled >= 3) return null;
    // Its own button: one the pop-up holds (by its title), never a button of the page behind it.
    const inPopup = (e: ElementInfo) => popupHas(top, e);
    const saveButton = (snap: PageSnapshot | null) => saveButtonIn(top, snap ?? inside);
    let button = saveButton(inside);
    if (!button) return null;
    const key = `${top.title}|save`;
    if (this.savedForms.has(key)) return null;
    this.savedForms.add(key);
    if (!(await this.mayTrySaving(top, button.name, capture))) return null;
    const lines = (d: DialogInfo | undefined) => new Set((d?.fullText ?? d?.text ?? '').split('\n').map((l) => l.trim()).filter(Boolean));
    let had = lines(top);
    const story: string[] = [];
    const tries = new Map<number, number>();
    for (let attempt = 1; attempt <= 5; attempt++) {
      this.set({ doing: attempt === 1 ? `Saving “${top.title}” with test values to see what it requires` : `Saving “${top.title}” again (try ${attempt}) after fixing what it said` });
      await this.browser.send({ kind: 'click', id: button.id, highlight: this.o.config.settings.highlightActions }).catch(() => undefined);
      // Every text that appeared after the press, wherever on the page — a notification in any corner, even one gone again.
      const settled = await this.browser.send({ kind: 'settle', quietMs: 600, timeoutMs: 7000 }).catch(() => null);
      // What the server answered (a refusal it may not show on the page: “NHI already exists”) counts as what it said.
      const calls = await this.browser.apiCallsSince().catch(() => []);
      this.noteApi(capture, calls.map(describeCall), `saving “${top.title}”`);
      const refusals = calls.filter((c) => !c.ok).map((c) => c.answer);
      const appeared = [...(settled?.effect?.added ?? []).map((t) => t.trim()).filter((t) => t && t.length < 300), ...refusals];
      const { dialogs } = await this.browser.send({ kind: 'dialogs', waitMs: 400 }).catch(() => ({ dialogs: [] as DialogInfo[] }));
      // The form itself, by its title — another pop-up on screen after the save (a notice) is not the form still open.
      const still = dialogs.find((d) => d.title === top.title);
      if (!still) {
        story.push(attempt === 1 ? 'it closed — saved (test record added)' : `try ${attempt}: it closed — saved (test record added)`);
        break;
      }
      // Why it was refused: the fields' own errors, the form's message, a notification.
      const found = await this.browser.send({ kind: 'formErrors', scope: top.title }).catch(() => ({ fields: [], messages: [] as string[] }));
      const errs = { fields: found.fields, messages: found.messages.filter((m) => ERROR_WORDS.test(m) || !!exampleIn(m)) };
      const said = [...lines(still)].filter((l) => !had.has(l) && l.length < 200).slice(0, 12);
      had = lines(still);
      const snap = await this.read().catch(() => null);
      const fields = (snap?.elements ?? []).filter((e) => inPopup(e) && !e.disabled);
      const byId = new Map(fields.map((e) => [e.id, e]));
      // The fields to fix: those showing an error, those it marked wrong, required ones left empty, and those a
      // message names (“NHI already exists”).
      const fix = new Map<number, string>();
      for (const f of errs.fields) if (byId.has(f.id)) fix.set(f.id, f.error);
      for (const e of fields) {
        if (fix.has(e.id)) continue;
        const name = (labelOf(e) || e.label || '').replace(/\s*\*$/, '').trim();
        const named = [...errs.messages, ...said, ...appeared].find((m) => mentions(m, name) && ERROR_WORDS.test(m));
        if (e.invalid) fix.set(e.id, named || '(marked wrong)');
        else if (e.required && !e.value?.trim() && !e.checked) fix.set(e.id, named || 'required, left empty');
        else if (named) fix.set(e.id, named);
      }
      const reasons = [...errs.fields.map((f) => `“${f.label || 'a field'}”: ${f.error}`), ...errs.messages, ...said.filter((l) => ERROR_WORDS.test(l)), ...appeared.filter((l) => ERROR_WORDS.test(l)), ...refusals.map((r) => `the server: ${r}`)];
      story.push(`${attempt === 1 ? 'it stayed open' : `try ${attempt}: still open`}${reasons.length ? ` — it said: ${[...new Set(reasons)].slice(0, 10).join(' | ')}` : ' — no reason shown'}`);
      if (!fix.size || attempt === 5) break;
      // Each field fixed the way its error asks.
      const done: string[] = [];
      for (const [id, error] of fix) {
        const e = byId.get(id);
        if (!e) continue;
        const hints = [...errs.fields.map((x) => x.error), ...errs.messages, ...said, ...appeared];
        const n = (tries.get(id) ?? 0) + 1;
        tries.set(id, n);
        // A field it may leave empty that is refused again and again (a code with a check digit): left empty.
        if (n >= 3 && !e.required && !isDropdown(e) && e.value?.trim()) {
          await this.browser.send({ kind: 'clear', id: e.id, highlight: this.o.config.settings.highlightActions }).catch(() => undefined);
          done.push(`“${labelOf(e) || e.label || e.role}” left empty (not required, its value kept being refused)`);
          continue;
        }
        const v = await this.fixField(e, error, attempt, hints).catch(() => '');
        if (v) done.push(`“${labelOf(e) || e.label || e.role}” → ${v}`);
      }
      story.push(`fixed ${done.length ? done.join('; ') : 'nothing it could change'}`);
      if (!done.length) break;
      button = saveButton(await this.read().catch(() => null)) ?? button;
    }
    return `Saving “${top.title}” with test values (“${button.name}”): ${story.join('. ')}.`;
  }

  /** One field fixed the way the form's error asks; returns what it holds now ('' when nothing could be done). */
  private async fixField(e: ElementInfo, error: string, attempt: number, hints: string[] = []): Promise<string> {
    const words = `${labelOf(e)} ${e.label ?? ''} ${e.name} ${e.placeholder ?? ''}`;
    this.set({ doing: `Fixing “${labelOf(e) || e.label || e.role}”: ${error.slice(0, 80)}` });
    if (isDateField(e)) return this.fillDate(e);
    if (isDropdown(e) || e.tag === 'select' || e.role === 'combobox') {
      const options = (e.options?.length ? e.options : await this.optionsOf(e).catch(() => [])).filter((o) => !PLACEHOLDER_CHOICE.test(o.trim()));
      const pick = options.filter((o) => o.trim() !== (e.value ?? '').trim())[attempt - 1] ?? options[0];
      if (!pick) return '';
      const r = await this.browser.send({ kind: 'select', id: e.id, option: pick, highlight: this.o.config.settings.highlightActions }).catch(() => null);
      return r?.selected ?? '';
    }
    if (e.role === 'checkbox' || e.role === 'switch' || e.role === 'radio') {
      await this.browser.send({ kind: 'click', id: e.id, highlight: this.o.config.settings.highlightActions }).catch(() => undefined);
      return 'ticked';
    }
    const current = (e.value ?? '').trim();
    // The form's own example for this field: in its error, its placeholder, or a message that names it (“Location — Use
    // latitude,longitude, e.g. -36.8485,174.7633”); else the only example the form gave at all.
    const name = (labelOf(e) || e.label || '').replace(/\s*\*$/, '').trim().toLowerCase();
    const named = hints.filter((h) => mentions(h, name)).map(exampleIn).find(Boolean);
    const all = [...new Set(hints.map(exampleIn).filter((x): x is string => !!x))];
    const example = exampleIn(error) ?? exampleIn(e.placeholder ?? '') ?? named ?? (all.length === 1 ? all[0] : null);
    let value: string;
    if (/already|exist|duplicate|taken|in use|unique|registered|someone else/i.test(error)) value = uniqueLike(current || example || this.s.text);
    else if (/colou?r|hex/i.test(`${words} ${error}`)) value = ['#2563EB', '#16A34A', '#D97706', '#7C3AED'][attempt - 1] ?? '#2563EB';
    else if (example) value = example === current ? uniqueLike(example) : example;
    else if (/e-?mail/i.test(`${words} ${error}`)) value = `test+${Date.now().toString(36)}@test.com`;
    else if (/phone|mobile|\btel\b/i.test(`${words} ${error}`)) value = `021${String(Date.now()).slice(-7)}`;
    else if (/number|digit|numeric|integer|amount|\d/i.test(error)) value = String(10 + attempt);
    else value = current ? uniqueLike(current) : dummyFor({ ...e, value: '' }, this.s) ?? this.s.text;
    if (current) await this.browser.send({ kind: 'clear', id: e.id, highlight: false }).catch(() => undefined);
    await this.browser.send({ kind: 'type', id: e.id, text: value, clear: true, highlight: this.o.config.settings.highlightActions }).catch(() => undefined);
    return value;
  }

  /** A drawer or pop-up left open over the page: closed before anything on the page is clicked. */
  private async closeLeftOpen(pageUrl: string) {
    const { dialogs } = await this.browser.send({ kind: 'dialogs', waitMs: 100 }).catch(() => ({ dialogs: [] as DialogInfo[] }));
    const open = dialogs.filter((d) => !this.partOfPage.has(`${pageUrl}|${d.title}`));
    if (!open.length) return;
    const top = open.find((d) => d.onTop) ?? open[open.length - 1];
    this.set({ doing: `Closing “${top.title || 'a pop-up'}” before going on with the page` });
    await this.closePopup(top, pageUrl);
    const { dialogs: still } = await this.browser.send({ kind: 'dialogs', waitMs: 200 }).catch(() => ({ dialogs: [] as DialogInfo[] }));
    for (const d of still) this.partOfPage.add(`${pageUrl}|${d.title}`);
  }

  private async closePopup(d: DialogInfo, pageUrl: string) {
    if (d.close) await this.browser.send({ kind: 'click', id: d.close.id, highlight: false }).catch(() => undefined);
    else await this.browser.send({ kind: 'key', key: 'Escape' }).catch(() => undefined);
    await sleep(350, this.abort.signal);
    const { dialogs } = await this.browser.send({ kind: 'dialogs', waitMs: 200 }).catch(() => ({ dialogs: [] as DialogInfo[] }));
    if (dialogs.length) {
      // A pop-up that will not close (or asks “discard changes?”): the page is opened again.
      await this.browser.navigate(pageUrl, this.abort.signal);
      await sleep(400, this.abort.signal);
    }
  }

  /** A tab the click opened: this site's → queued and closed; another site's → kept, for a crawl of its own. */
  private async newTab(tab: chrome.tabs.Tab, via: string): Promise<string> {
    await sleep(1200, this.abort.signal);
    const now = (await chrome.tabs.get(tab.id!).catch(() => null)) ?? tab;
    const url = normalizeUrl(now.url || now.pendingUrl || '') ?? '';
    const agentTab = this.browser.currentTabId;
    if (agentTab !== null) await chrome.tabs.update(agentTab, { active: true }).catch(() => undefined);
    if (url && sameSite(url, this.state.host)) {
      this.enqueue({ url, from: { url: this.state.current?.url ?? '', title: this.state.current?.title ?? '', via: `“${via}”` } });
      await chrome.tabs.remove(tab.id!).catch(() => undefined);
      return `opens ${pathOf(url)} in a new tab`;
    }
    if (url) this.addOtherSite({ host: hostOf(url), url, tabId: tab.id ?? null });
    return `opens another site in a new tab (${url ? hostOf(url) : 'a new tab'}) — it gets its own knowledge base`;
  }

  private addOtherSite(o: OtherSite) {
    if (!o.host || o.host === this.state.host || this.state.otherSites.some((s) => s.host === o.host)) return;
    this.set({ otherSites: [...this.state.otherSites, o] });
    this.log(`Another site opened: ${o.host}. You can learn it after this one.`);
  }

  // ---------- Session

  /** The site sent the crawler to its sign-in page (or shows a sign-in form where a page was). */
  private async sessionGone(url: string, wanted: string): Promise<boolean> {
    const login = (u: string) => isLoginUrl(u) || (!!this.loginPage && templateOf(u) === this.loginPage);
    if (login(url) && !login(wanted)) return true;
    return !login(wanted) && (await this.looksSignedOut());
  }

  private async looksSignedOut(): Promise<boolean> {
    const snap = await this.browser.send({ kind: 'snapshot', mode: 'overview', maxElements: 60, maxTextChars: 600 }).catch(() => null);
    if (!snap) return false;
    // A sign-in form (a password field) on a page that is little else — no menus, few controls — in any language.
    const password = snap.elements.some((e) => e.type === 'password');
    const links = snap.elements.filter((e) => e.role === 'link').length;
    return password && snap.elements.length < 25 && links < 8;
  }

  private async waitForLogin(url: string, first: boolean) {
    if (!first) {
      const minutes = Math.max(1, Math.round((Date.now() - this.signedInAt) / 60_000));
      this.notes.push(`The session ended after about ${minutes} minute(s) of use: the site showed its sign-in page (${pathOf(url)}).`);
      this.log(`Signed out (after about ${minutes} min). Sign in again, then press Resume.`, 'warn');
    } else this.log('Sign in to the site in this tab, then press Resume.', 'warn');
    await this.browser.setPresence(false);
    const answer = await this.ask({ kind: 'session', url, first });
    if (answer !== 'resume') {
      this.stopping = true;
      throw new Error(first ? 'Sign in first, then start again.' : 'Stopped: the session ended.');
    }
    this.signedInAt = Date.now();
    await this.browser.setPresence(true);
  }

  // ---------- Writing

  private async writeLoop() {
    for (;;) {
      // Cancelled while waiting: out at once (an aborted sleep rejects at once, and the wait would spin and freeze the panel).
      while (!this.writeQueue.length) {
        if (this.abort.signal.aborted) return;
        await sleep(300, this.abort.signal).catch(() => undefined);
      }
      if (this.abort.signal.aborted) return;
      const page = this.writeQueue.shift();
      if (!page) return;
      const written = await this.call(pagePrompt(page, this.budget), `Writing knowledge: ${page.title || pathOf(page.url)}`);
      if (written) this.addWritten(written.entries, written.neverClick, page.url);
      if (written) this.written.add(captureKey(page));
      this.set({ writing: { done: this.state.writing.done + 1, total: this.state.writing.total } });
    }
  }

  private async writeSite() {
    if (!this.state.pages.length) return;
    this.set({ doing: 'Writing the site map and workflows…' });
    const known = this.state.proposals.map((p) => `${p.kind}: ${p.title} — ${p.content.split('\n')[0].slice(0, 120)}`);
    const pages = this.state.pages.map((p) => ({ title: p.title, url: p.url, via: this.vias.get(p.url) || undefined }));
    const written = await this.call(sitePrompt(this.state.siteName, pages, known, this.notes, this.budget), 'Writing the site map and workflows');
    if (written) this.addWritten(written.entries, written.neverClick, this.state.startUrl);
  }

  private addWritten(entries: { kind: ProposedEntry['kind']; title: string; content: string; trigger?: string }[], never: string[], source: string) {
    const proposals = addProposals(this.state.proposals, entries.map((e) => ({ ...e, source })), this.o.existing?.entries ?? []);
    const neverClick = [...this.state.neverClick];
    for (const n of never) if (!neverClick.some((x) => x.toLowerCase() === n.toLowerCase())) neverClick.push(n);
    this.set({ proposals, neverClick });
  }

  /** Rules the crawl itself showed: the session's length, the controls that need the user's OK. */
  private addCrawlRules() {
    const entries: { kind: 'rule'; title: string; content: string }[] = [];
    if (this.notes.some((n) => n.startsWith('The session ended'))) {
      entries.push({
        kind: 'rule',
        title: 'Session expires',
        content: `${this.notes.filter((n) => n.startsWith('The session ended')).join('\n')}\nWhen the sign-in page shows, stop and ask the user to sign in again, then carry on where you were.`,
      });
    }
    const asked = [...this.clickedNames.entries()].filter(([, v]) => v.endsWith('not clicked')).map(([k]) => k);
    if (asked.length) {
      entries.push({ kind: 'rule', title: 'Controls that change data', content: `These controls delete, save, send or sign out — ask the user before clicking them: ${asked.slice(0, 30).map((a) => `“${a}”`).join(', ')}.` });
    }
    if (entries.length) this.addWritten(entries, [], this.state.startUrl);
  }

  /** One model call, retried; when the model can't be reached the user chooses: try again, or go on without it. */
  private async call(messages: ReturnType<typeof pagePrompt>, purpose: string) {
    // The spending limit: reached, the user says whether it may spend as much again.
    if (this.writingStopped) return null;
    if (this.s.spendLimit > 0 && this.state.spent >= this.spendCap) {
      const answer = this.s.unattended ? 'finish' : await this.ask({ kind: 'budget', spent: this.state.spent, limit: this.spendCap });
      if (answer !== 'more') {
        this.writingStopped = true;
        this.log(`Stopped writing at ${this.state.spent.toFixed(2)} (the spending limit). What was written so far is kept.`, 'warn');
        return null;
      }
      this.spendCap += this.s.spendLimit;
    }
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.client!.chat({ model: this.model, messages, tools: [], temperature: 0.2, signal: this.abort.signal, purpose });
        const written = parseWritten(res.content);
        if (!written.entries.length && attempt === 0) {
          // A reply that wasn't JSON: asked once more, plainly.
          messages = [...messages, { role: 'assistant', content: res.content.slice(0, 2000) }, { role: 'user', content: 'Answer again with the JSON object only, as described.' }];
          continue;
        }
        return written;
      } catch (err) {
        if (this.abort.signal.aborted) return null;
        if (attempt < 2) {
          await sleep(attempt === 0 ? 3000 : 10_000, this.abort.signal).catch(() => undefined);
          continue;
        }
        const message = err instanceof Error ? err.message : String(err);
        this.log(`The model did not answer: ${message}`, 'warn');
        if (this.s.unattended) return null; // on its own: this page goes unwritten, the rest go on
        const answer = await this.ask({ kind: 'model', error: message });
        if (answer === 'retry') {
          attempt = -1;
          continue;
        }
        return null;
      }
    }
  }

  // ---------- Plumbing

  private ask(p: NewPrompt): Promise<CrawlAnswer> {
    if (this.abort.signal.aborted) return Promise.resolve('finish');
    const prompt = { ...p, id: uid('ask_') } as CrawlPrompt;
    this.set({ prompts: [...this.state.prompts, prompt] });
    // Time spent waiting for the answer is not exploring time.
    const since = Date.now();
    return new Promise((resolve) =>
      this.resolvers.set(prompt.id, (a) => {
        this.waitedMs += Date.now() - since;
        resolve(a);
      }),
    );
  }

  private async gate() {
    if (this.abort.signal.aborted) throw new Error('cancelled');
    if (this.paused) {
      const since = Date.now();
      while (this.paused) await new Promise<void>((r) => (this.resumeWait = r));
      this.waitedMs += Date.now() - since;
    }
    if (this.abort.signal.aborted) throw new Error('cancelled');
    // Every field and click passes here: the minutes shown keep up while a long page is read.
    if (this.state.phase === 'exploring') this.tick();
  }

  private log(text: string, tone?: 'warn' | 'ok') {
    this.set({ log: [...this.state.log, { at: Date.now(), text, ...(tone ? { tone } : {}) }].slice(-MAX_LOG) });
  }

  private set(patch: Partial<CrawlState>) {
    const phaseBefore = this.state.phase;
    this.state = { ...this.state, ...patch };
    this.o.onState(this.state);
    this.keep(this.state.phase !== phaseBefore);
  }

  /**
   * What was read and written, kept in the browser's storage (every few seconds, and at once when the phase changes):
   * a closed panel or a reloaded extension loses nothing — the crawl is opened again from there.
   */
  /** Its knowledge was saved (or it was thrown away): never kept in storage again — a save waiting is dropped too. */
  stopKeeping() {
    this.forgotten = true;
    if (this.keepTimer) clearTimeout(this.keepTimer);
    this.keepTimer = null;
  }

  private forgotten = false;

  private keep(now: boolean) {
    // Kept from the first page on: a page takes a minute or more, and its queue is already the way through the site.
    const exploring = (this.state.phase === 'exploring' || this.state.phase === 'paused') && (this.queue.length > 0 || !!this.visiting);
    if (this.forgotten || !KEPT_PHASES.has(this.state.phase) || !this.state.host || (!this.state.captures.length && !exploring)) return;
    // At most every 3 s while it works — a save waiting is not put off by the next change (that starved it while the
    // crawl kept changing) — and at once when the phase changes.
    if (now) {
      if (this.keepTimer) clearTimeout(this.keepTimer);
      this.keepTimer = null;
      void saveCrawl(this.saved()).catch(() => undefined);
      return;
    }
    if (this.keepTimer) return;
    this.keepTimer = setTimeout(() => {
      this.keepTimer = null;
      if (this.forgotten) return;
      void saveCrawl(this.saved()).catch(() => undefined);
    }, 3000);
  }

  private saved(): SavedCrawl {
    const s = this.state;
    return {
      id: s.id, host: s.host, siteName: s.siteName, startUrl: s.startUrl, model: s.model,
      phase: s.phase, pagesDone: s.pagesDone, captures: s.captures, pages: s.pages, proposals: s.proposals,
      neverClick: s.neverClick, otherSites: s.otherSites, spent: s.spent, startedAt: s.startedAt,
      written: [...this.written], notes: this.notes, savedAt: Date.now(),
      ...(s.phase === 'exploring' || s.phase === 'paused' ? { explore: this.exploreState() } : {}),
      base: this.o.base ?? null,
      mode: this.o.mode ?? 'update',
      overrides: this.o.overrides ?? {},
    };
  }

  /**
   * A crawl kept in storage, opened again: what was read is shown (exploring can't go on — its place in the site is
   * gone), and writing goes on with the pages not written yet; written entries are kept for review.
   */
  async restore(saved: SavedCrawl): Promise<CrawlState> {
    this.written = new Set(saved.written ?? []);
    this.notes = [...(saved.notes ?? [])];
    for (const c of saved.captures) if (c.from) this.vias.set(c.url, `${c.from.title || pathOf(c.from.url)} › ${c.from.via}`);
    // Kept while exploring, with its place in the site: it carries on exploring from there, once the user says so.
    const e = saved.explore;
    if (e && (saved.phase === 'exploring' || saved.phase === 'paused') && (e.queue.length || e.visiting)) return this.carryOn(saved, e);
    const review = saved.phase === 'review';
    this.set({
      id: saved.id, host: saved.host, siteName: saved.siteName, startUrl: saved.startUrl, model: saved.model,
      pagesDone: saved.pagesDone, captures: saved.captures, pages: saved.pages, proposals: saved.proposals,
      neverClick: saved.neverClick, otherSites: saved.otherSites ?? [], spent: saved.spent ?? 0, startedAt: saved.startedAt,
      phase: review ? 'review' : 'explored', prompts: [], current: null,
      writing: { done: this.written.size, total: saved.captures.length },
      doing: review ? 'Review what was learned, then save.' : `Opened again: ${saved.pagesDone} pages read${this.written.size ? `, ${this.written.size} written` : ''}. Write the knowledge base when ready.`,
    });
    this.log(`Opened the crawl kept from ${new Date(saved.savedAt).toLocaleString()} — nothing was lost.`, 'ok');
    if (review) return this.state;
    try {
      this.setupModel();
    } catch (err) {
      this.set({ error: err instanceof Error ? err.message : String(err) });
    }
    // Its spending so far counts toward the limit.
    while (this.spendCap > 0 && this.spendCap <= this.state.spent) this.spendCap += this.s.spendLimit;
    // Writing as it explores: opened again, it goes on writing at once; otherwise it waits for Write.
    if (!this.s.writeWhileExploring) await new Promise<void>((resolve) => (this.goWrite = resolve));
    if (this.abort.signal.aborted) return this.state;
    const left = this.state.captures.filter((c) => !this.written.has(captureKey(c)));
    this.writeQueue.push(...left);
    this.writer = this.writeLoop();
    return this.finishWriting();
  }

  /** A crawl kept while exploring, opened again: paused where it was; Resume carries on with its queue. */
  private async carryOn(saved: SavedCrawl, e: ExploreState): Promise<CrawlState> {
    // The page being read when it stopped is read again: it isn't counted twice.
    const captured = new Set(saved.captures.map((c) => c.url));
    const redo = e.visiting && !captured.has(e.visiting.url) ? e.visiting.url : null;
    const pages = redo ? saved.pages.filter((p) => p.url !== redo) : saved.pages;
    this.set({
      id: saved.id, host: saved.host, siteName: saved.siteName, startUrl: saved.startUrl, model: saved.model,
      pagesDone: Math.max(0, saved.pagesDone - (saved.pages.length - pages.length)), captures: saved.captures, pages, proposals: saved.proposals,
      neverClick: saved.neverClick, otherSites: saved.otherSites ?? [], spent: saved.spent ?? 0, startedAt: saved.startedAt,
      prompts: [], current: null, phase: 'paused',
      writing: { done: this.written.size, total: saved.captures.length },
    });
    this.takeExploreState(e, captured);
    this.paused = true;
    this.set({ doing: `Opened again: ${this.state.pagesDone} pages read, ${this.queue.length} waiting. Open the site in this tab (signed in), then press Resume to carry on.` });
    this.log(`Opened the crawl kept from ${new Date(saved.savedAt).toLocaleString()} — it carries on from where it was.`, 'ok');
    try {
      this.setupModel();
    } catch (err) {
      this.set({ error: err instanceof Error ? err.message : String(err) });
    }
    while (this.spendCap > 0 && this.spendCap <= this.state.spent) this.spendCap += this.s.spendLimit;
    // Pages read but not written yet: written while it explores (or all at the end, when the settings say so).
    if (this.s.writeWhileExploring) {
      this.writeQueue.push(...this.state.captures.filter((c) => !this.written.has(captureKey(c))));
      this.writer = this.writeLoop();
    }
    return this.exploreThenWrite(async () => {
      await this.gate();
      await this.browser.setPresence(true);
      this.signedInAt = Date.now();
      await this.explore();
      this.log(this.stopping ? 'Exploring stopped.' : 'Every page found has been visited.', 'ok');
      await this.browser.setPresence(false);
    });
  }
}

function controlLine(e: ElementInfo): string {
  const name = e.name?.trim() || e.label || e.placeholder || '';
  if (!name && !e.href) return '';
  const bits = [`${e.role} “${name}”`];
  if (e.href) bits.push(`→ ${e.href}`);
  if (e.hasMenu) bits.push('(opens a menu)');
  if (e.options?.length) bits.push(`options: ${e.options.slice(0, 10).join(', ')}`);
  if (e.context) bits.push(`(in ${e.context.slice(0, 60)})`);
  return bits.join(' ');
}

function dialogLine(d: DialogInfo): string {
  return `“${d.title || 'Pop-up'}”: ${(d.text || '').replace(/\s+/g, ' ').slice(0, 300)}${d.form?.length ? `\n  fields: ${d.form.slice(0, 15).join('; ')}` : ''}`;
}

/**
 * Month and weekday names, long and short, in the browser's languages and English — from the browser's own
 * calendar data, so a site in any of them reads “12 Nov” and “19 Nov” as the same screen.
 */
const DATE_WORDS: RegExp = (() => {
  const langs = [...new Set([...(typeof navigator !== 'undefined' ? navigator.languages ?? [] : []), 'en'])];
  const words = new Set<string>();
  for (const lang of langs) {
    try {
      for (const style of ['long', 'short'] as const) {
        const month = new Intl.DateTimeFormat(lang, { month: style });
        const day = new Intl.DateTimeFormat(lang, { weekday: style });
        for (let i = 0; i < 12; i++) words.add(month.format(new Date(2026, i, 1)).toLowerCase().replace(/\.$/, ''));
        for (let i = 0; i < 7; i++) words.add(day.format(new Date(2026, 0, 4 + i)).toLowerCase().replace(/\.$/, ''));
      }
    } catch {
      /* a language the browser has no calendar for */
    }
  }
  const list = [...words].filter((w) => w.length > 1).sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(?<![\\p{L}])(${list.join('|')})(?![\\p{L}])`, 'giu');
})();

/** Headings without their dates and numbers: the same screen on another day is the same screen. */
const plainHeadings = (headings: string[]) =>
  headings
    .map((h) => h.toLowerCase().replace(DATE_WORDS, '').replace(/[\d/.,:\-–]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

/** What makes one screen another: its title and headings, without dates and counts. */
export function screenSignature(s: Pick<PageSnapshot, 'title' | 'headings'>): string {
  return `${s.title.toLowerCase().replace(/[\d]+/g, '')}|${plainHeadings(s.headings).slice(0, 6).join('|')}`;
}

/**
 * The page shows another screen now: other headings, or mostly other words in its text — a sidebar folding changes
 * the controls' labels but not the page's words.
 */
function differs(after: PageSnapshot, before: PageCapture): boolean {
  const h1 = plainHeadings(after.headings).join('|');
  if (h1 && h1 !== plainHeadings(before.headings).join('|')) return true;
  const lines = (t: string) => new Set(t.split('\n').map((l) => l.trim().toLowerCase()).filter((l) => l.length > 3 && !/^\d/.test(l)));
  const now = lines(after.text);
  const was = lines(before.text);
  if (now.size < 5 || was.size < 5) return false;
  let same = 0;
  for (const l of now) if (was.has(l)) same++;
  return same / Math.max(now.size, was.size) < 0.5;
}

/** Which row of a table or grid a control is in (0: none). */
export function rowOf(e: Pick<ElementInfo, 'context'>): number {
  return Number(/(?:^|\b)row (\d+)/i.exec(e.context ?? '')?.[1] ?? 0);
}

/** A control's name — an icon with none is called after its kind and where it is. */
/** An id a UI library generates for an element (“mantine-7h7thhc5z”, “radix-:r1:”, “react-select-3-input”), not a name. */
export const GENERATED_NAME = /^(?:[a-z]+[-_:])+(?=[a-z0-9:_-]*\d)[a-z0-9:_-]{4,}$/i;

export function labelOf(e: Pick<ElementInfo, 'name' | 'label' | 'placeholder' | 'role' | 'tag' | 'context'>): string {
  const name = (e.name || e.label || e.placeholder || '').trim();
  if (name && !GENERATED_NAME.test(name)) return name;
  if (e.role !== 'button' && e.role !== 'clickable' && e.role !== 'menuitem') return '';
  const where = e.context ? ` in ${e.context.replace(/[“”"]/g, '').slice(0, 40)}` : '';
  return `unnamed icon (${e.tag})${where}`;
}

/** What a control does wherever it is: it opens a page, a menu, another tab, or was not clicked. */
export const sharedOutcome = (o: string) => /^(opens the page|opens a menu|goes to|opens another site|opens \/|shows the “)/.test(o) || o.includes('not clicked');

/** Lines seen while scrolling that the page's text did not have (lists that draw only the rows on screen). */
function addScrolledText(c: PageCapture, scrolled: { boxes: number; lines: string[] }) {
  if (!scrolled.lines.length) return;
  const have = new Set(c.text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()));
  const extra = scrolled.lines.filter((l) => !have.has(l));
  if (extra.length) c.text = `${c.text}\n\n[More seen while scrolling]\n${extra.join('\n')}`;
  if (scrolled.boxes > 1) c.headings = [...c.headings, `(page has ${scrolled.boxes} scrolling areas, all read)`];
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}${u.hash}` || '/';
  } catch {
    return url;
  }
}

const withScheme = (s: string) => (/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`);
