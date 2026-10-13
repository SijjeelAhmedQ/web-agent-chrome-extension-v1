import type { StepRecord, TaskRecord } from '@/shared/types/history';

export interface ApprovalPrompt {
  id: string;
  stepId: string;
  title: string;
  detail: string;
  confirmLabel: string;
  site: string;
  fields?: { label: string; value: string }[];
}

/** Everything the UI needs to show a run as it happens. */
export type RunEvent =
  | { type: 'task'; task: TaskRecord }
  | { type: 'step'; taskId: string; step: StepRecord }
  | { type: 'thinking'; taskId: string; active: boolean }
  | { type: 'approval'; taskId: string; prompt: ApprovalPrompt | null };
