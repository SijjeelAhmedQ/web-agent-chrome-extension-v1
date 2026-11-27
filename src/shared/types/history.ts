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

/** How big a model is, when models are picked per task. */
export type ModelTier = 'small' | 'medium' | 'big';
/** clicks: only UI steps. analysis: reading data and working it out. judged: changes a record, or the words don't say. */
export type TaskKind = 'code' | 'clicks' | 'analysis' | 'judged';

/** Why a task got the models it got: for the log. */
export interface TaskRoute {
  kind: TaskKind;
  /** The word of the request that said so. */
  word?: string;
  /** clicks: the model that did it. analysis: the one that wrote the analysis. judged: the one that did the steps. */
  model?: string;
  /** The model that did the clicks and the reading, when another one wrote the analysis. */
  reader?: string;
  /** The decision model, when it was asked. */
  chooser?: string;
  /** The decision model's answer was not a model on the list (or it gave none): the agent's own model did it. */
  fallback?: boolean;
  /** The first model got stuck: the decision model picked this one to carry on. */
  stuckModel?: string;
  /** @deprecated Tasks from before the user's model list: the fixed model's size. */
  tier?: ModelTier;
  /** @deprecated As `stuckModel`, from before. */
  stuckTier?: ModelTier;
}

/**
 * One call to a model in a task: what it was for, what went in and what it cost. The task's log of these says
 * where its tokens and dollars went.
 */
export interface ModelCallRecord {
  at: number;
  durationMs: number;
  /** The agent's own model, or its decision model. */
  role: 'worker' | 'decider';
  /** What the call was for, e.g. “Doing a step”, “Deciding the next step”, “Double-check”. */
  purpose: string;
  model: string;
  /** The model that answered, when a router (Jev Router) picked another. */
  servedBy?: string;
  /** Tokens in, as the server counted them (or estimated, see `estimated`). */
  inputTokens?: number;
  /** Of the input, read from the prompt cache — billed at a fraction. */
  cachedTokens?: number;
  /** Headroom compressed this call's messages: tokens before and after (its proxy's count). */
  headroom?: { before: number; after: number };
  outputTokens?: number;
  /** Of the output, the model's thinking. */
  reasoningTokens?: number;
  /** In dollars, when the server reports it (OpenRouter). */
  cost?: number;
  /** The server sent no token counts: `inputTokens` is our estimate. */
  estimated?: boolean;
  /** What the reply did, in short: the tools it called (“open_menu Patients › Search & List”) or the start of its answer. */
  did?: string;
  /** With models picked per task: this call's part. */
  tier?: ModelTier | 'chooser';
  /** What the prompt was made of, in estimated tokens. */
  parts: { system: number; knowledge: number; tools: number; pages: number; rest: number };
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
  /** Every model call of this task, in order. */
  calls?: ModelCallRecord[];
  /** With models picked per task: which, and why. */
  route?: TaskRoute;
  /** Set on a team member's task: the team task it belongs to. */
  parentId?: string;
}
