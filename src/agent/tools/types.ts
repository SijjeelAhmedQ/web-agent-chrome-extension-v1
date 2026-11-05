import type { z } from 'zod';
import type { BrowserController } from '@/extension/browser/controller';
import type { ToolRisk } from '@/shared/constants/tools';
import type { Settings, SkillConfig } from '@/shared/types/config';
import type { ElementInfo } from '@/shared/types/page';
import type { PageMemo } from './pageDiff';

/** What the agent remembers about element ids it has seen, for readable activity labels. */
export class ElementMemory {
  private map = new Map<number, Pick<ElementInfo, 'id' | 'name' | 'role' | 'type' | 'value' | 'context' | 'inBlockingPopup' | 'label'> & { batch: number }>();
  private batch = 0;
  /** The elements of the last full page read, kept apart: find_element's few matches don't replace them. */
  private page: ElementInfo[] = [];
  remember(elements: ElementInfo[], wholePage = false) {
    this.batch++;
    if (wholePage) this.page = elements;
    for (const e of elements) this.map.set(e.id, { id: e.id, name: e.name, role: e.role, type: e.type, value: e.value, context: e.context, inBlockingPopup: e.inBlockingPopup, label: e.label, batch: this.batch });
  }
  get(id: number) {
    return this.map.get(id);
  }
  /** Elements whose name matches, from the latest read that had any (older ones may be gone), in page order. */
  named(name: string, matches: (expected: string, actual: string) => boolean) {
    const found = [...this.map.values()].filter((e) => e.name && matches(name, e.name));
    const newest = Math.max(0, ...found.map((e) => e.batch));
    return found.filter((e) => e.batch === newest).sort((a, b) => a.id - b.id);
  }
  /** The elements of the last full page read — what is on the page now, as far as the agent knows. */
  onPage() {
    return this.page;
  }
  clear() {
    this.map.clear();
  }
}

export interface ToolContext {
  browser: BrowserController;
  settings: Settings;
  signal: AbortSignal;
  elements: ElementMemory;
  skills: SkillConfig[];
  /** Names of buttons the agent may never click on this site (from its site setup). */
  neverClick?: string[];
  /** Names of controls that change a record the moment they are clicked: the user approves them first. */
  askBefore?: string[];
  /** The agent asks before every action: a tool clicks nothing on its own (open_menu leaves the last item to click). */
  askEveryAction?: boolean;
  /** Pop-ups only the user answers (words of their title or text): their buttons need the user's OK. */
  askPopups?: string[];
  /** The site knowledge in the current instructions: what site_knowledge need not repeat. */
  knowledgeInPrompt?: () => string;
  /** What the user wrote in this message — a button it names is the user's answer already. */
  userSaid?: string;
  /** PDFs already read in this task, by address → their text (or why there is none). */
  pdfTexts?: Map<string, string>;
  /** Lists read with read_records in this task (page and first record → how many records). */
  recordsRead?: Map<string, number>;
  /** What the last read_page saw — the next read of the same page gives only the changes. */
  lastPage?: PageMemo;
  /** Characters of “only the changes” reads since the last whole read — a long chain can't be shortened. */
  diffChars?: number;
  /** Most page text in a read_page overview, for models with a small context (Kaggle's 16K). */
  overviewTextChars?: number;
  /** Titles of the pop-ups that came up with the page or tab that opened last. */
  arrivalPopups?: Set<string>;
  /**
   * A page just opened and the agent has only read it or closed pop-ups since: a pop-up that comes
   * up now (late, or inside another) is still one of the page's opening pop-ups.
   */
  arrivalOpen?: boolean;
}

export interface ToolOutcome {
  /** What the model reads. */
  output: string;
  /** Short plain-language outcome for the activity list. */
  note?: string;
  /** A click on something meant to open a page or record changed nothing (counts toward loop guards). */
  noEffect?: boolean;
}

export interface ApprovalRequest {
  title: string;
  detail: string;
  confirmLabel: string;
  /** What will be saved or sent — the user checks these before confirming. */
  fields?: { label: string; value: string }[];
  /** A pop-up form's own finishing buttons — the user picks which one is pressed. */
  choices?: { id: number; label: string }[];
  target?: number;
}

export interface AgentTool<A = Record<string, unknown>> {
  name: string;
  description: string;
  schema: z.ZodType<A, z.ZodTypeDef, unknown>;
  risk: ToolRisk;
  /** Does this tool read or change the page in the agent's tab? (site rules apply) */
  touchesPage: boolean;
  label(args: A, ctx: ToolContext): string;
  /** Under the “smart” policy: return a request when this particular call needs approval. */
  assess?(args: A, ctx: ToolContext): Promise<ApprovalRequest | null>;
  execute(args: A, ctx: ToolContext): Promise<ToolOutcome>;
  /** Overrides zod-derived JSON schema (custom tools, edited built-in tools). */
  jsonSchema?: Record<string, unknown>;
  /** The user set this tool to ask before every use. */
  alwaysAsk?: boolean;
}
