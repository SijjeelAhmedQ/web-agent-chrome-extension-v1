import type { z } from 'zod';
import type { BrowserController } from '@/extension/browser/controller';
import type { ToolRisk } from '@/shared/constants/tools';
import type { Settings, SkillConfig } from '@/shared/types/config';
import type { ElementInfo } from '@/shared/types/page';

/** What the agent remembers about element ids it has seen, for readable activity labels. */
export class ElementMemory {
  private map = new Map<number, Pick<ElementInfo, 'name' | 'role' | 'type'>>();
  remember(elements: ElementInfo[]) {
    for (const e of elements) this.map.set(e.id, { name: e.name, role: e.role, type: e.type });
  }
  get(id: number) {
    return this.map.get(id);
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
}

export interface ToolOutcome {
  /** What the model reads. */
  output: string;
  /** Short plain-language outcome for the activity list. */
  note?: string;
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
  /** Overrides zod-derived JSON schema (custom tools). */
  jsonSchema?: Record<string, unknown>;
}
