import type { StepRecord, TaskRecord } from '@/shared/types/history';

export interface ApprovalPrompt {
  id: string;
  stepId: string;
  title: string;
  detail: string;
  confirmLabel: string;
  site: string;
  fields?: { label: string; value: string }[];
  /** A pop-up form's own finishing buttons (Complete · Save · Reset · Cancel): the user picks which one is pressed. */
  choices?: { id: number; label: string }[];
  /** The button the agent meant to press (one of the choices). */
  target?: number;
}

/** Yes or no — or, for a form's buttons, the id of the one the user picked. */
export type ApprovalAnswer = boolean | number;

/** Everything the UI needs to show a run as it happens. */
export type RunEvent =
  | { type: 'task'; task: TaskRecord }
  | { type: 'step'; taskId: string; step: StepRecord }
  /** `label`: what the model is doing now, and which (“Deciding the next step · Jev Router”), when the agent has a decision model. */
  | { type: 'thinking'; taskId: string; active: boolean; label?: string }
  | { type: 'approval'; taskId: string; prompt: ApprovalPrompt | null };
