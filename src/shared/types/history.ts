export type TaskStatus = 'running' | 'done' | 'failed' | 'cancelled';
export type StepStatus = 'running' | 'done' | 'failed' | 'skipped' | 'waiting';

export interface StepRecord {
  id: string;
  /** Plain-language label, e.g. “Typing “OpenAI” into Search”. */
  label: string;
  status: StepStatus;
  tool: string;
  startedAt: number;
  durationMs?: number;
  /** Short user-facing outcome. */
  note?: string;
  /** Developer view only — kept only when developer mode is on. */
  args?: unknown;
  result?: string;
  error?: string;
}

/** One item of the agent's checklist for a request with several things to do. */
export interface ChecklistItem {
  text: string;
  done: boolean;
  note?: string;
  /** Something the user approved (a save, a delete…) was done for it — what lets an add be ticked. */
  saved?: boolean;
}

export interface TaskRecord {
  id: string;
  request: string;
  agentId: string;
  agentName: string;
  url: string;
  site: string;
  title: string;
  status: TaskStatus;
  startedAt: number;
  endedAt?: number;
  result?: string;
  error?: string;
  /** ErrorCode from shared/utils/errors, for recovery actions. */
  errorCode?: string;
  /** Technical detail — shown only in the developer view. */
  errorDetail?: string;
  steps: StepRecord[];
  /** The agent's checklist, when the request had several things to do. */
  checklist?: ChecklistItem[];
  /** Set on a team member's task: the team task it belongs to. */
  parentId?: string;
}
