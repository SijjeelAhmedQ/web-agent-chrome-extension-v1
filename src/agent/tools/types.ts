import type { z } from 'zod';
import type { BrowserController } from '@/extension/browser/controller';
import type { ToolRisk } from '@/shared/constants/tools';
import type { Settings, SkillConfig } from '@/shared/types/config';
import type { ElementInfo } from '@/shared/types/page';

/** What the agent remembers about element ids it has seen, for readable activity labels. */
export class ElementMemory {
  private map = new Map<number, Pick<ElementInfo, 'id' | 'name' | 'role' | 'type' | 'value' | 'context' | 'inBlockingPopup'> & { batch: number }>();
  private batch = 0;
  remember(elements: ElementInfo[]) {
    this.batch++;
    for (const e of elements) this.map.set(e.id, { id: e.id, name: e.name, role: e.role, type: e.type, value: e.value, context: e.context, inBlockingPopup: e.inBlockingPopup, batch: this.batch });
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
  /** The elements of the latest read (what is on the page now, as far as the agent knows). */
  newest() {
    const newest = Math.max(0, ...[...this.map.values()].map((e) => e.batch));
    return [...this.map.values()].filter((e) => e.batch === newest);
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
  /** Titles of the pop-ups that came up with the page or tab that opened last. */
  arrivalPopups?: Set<string>;
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
