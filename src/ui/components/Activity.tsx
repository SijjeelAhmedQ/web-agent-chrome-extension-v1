import { AlertCircle, Check, ChevronDown, CircleSlash, Pause, Square, X } from 'lucide-react';
import { memo, useEffect, useId, useState } from 'react';
import type { StepRecord, TaskRecord } from '@/shared/types/history';
import { formatDuration } from '@/shared/utils';
import { Sparkle } from './Brand';

/**
 * The “what is the agent doing” timeline. Plain-language steps for everyone; tool names,
 * arguments and raw results only in the developer view.
 */

function StepIcon({ status }: { status: StepRecord['status'] }) {
  switch (status) {
    case 'done':
      return (
        <span className="step-icon done">
          <Check size={11} strokeWidth={3} />
        </span>
      );
    case 'failed':
      return (
        <span className="step-icon failed">
          <X size={11} strokeWidth={3} />
        </span>
      );
    case 'skipped':
      return (
        <span className="step-icon skipped">
          <CircleSlash size={11} strokeWidth={2.5} />
        </span>
      );
    case 'waiting':
      return (
        <span className="step-icon waiting">
          <Pause size={10} strokeWidth={3} />
        </span>
      );
    default:
      return <span className="step-icon running" aria-hidden />;
  }
}

const STATUS_TEXT: Record<StepRecord['status'], string> = {
  done: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
  waiting: 'Waiting for you',
  running: 'In progress',
};

function StepRow({ step, developer }: { step: StepRecord; developer: boolean }) {
  const [open, setOpen] = useState(false);
  const hasDetail = developer && (step.args !== undefined || step.result || step.error);
  return (
    <li className={`step ${step.status}`}>
      <StepIcon status={step.status} />
      <div className="step-body">
        <div className="step-line">
          <span className="step-label">{step.label}</span>
          <span className="sr-only">{STATUS_TEXT[step.status]}</span>
          {developer && step.durationMs !== undefined && <span className="step-time">{formatDuration(step.durationMs)}</span>}
        </div>
        {step.note && <div className="step-note">{step.note}</div>}
        {hasDetail && (
          <>
            <button type="button" className="step-detail-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              <span className="mono">{step.tool}</span> {open ? 'Hide' : 'Details'}
            </button>
            {open && (
              <pre className="step-detail mono">
                {step.args !== undefined && `args ${JSON.stringify(step.args, null, 2)}\n`}
                {step.error ? `error ${step.error}` : step.result ? `result\n${step.result}` : ''}
              </pre>
            )}
          </>
        )}
      </div>
    </li>
  );
}

interface ActivityProps {
  task: TaskRecord | null;
  thinking: boolean;
  developer: boolean;
  defaultExpanded: boolean;
}

export const ActivityCard = memo(function ActivityCard({ task, thinking, developer, defaultExpanded }: ActivityProps) {
  const status = task?.status ?? 'running';
  const running = status === 'running';
  const steps = task?.steps ?? [];
  const [expanded, setExpanded] = useState(running || defaultExpanded);
  const listId = useId();

  // Expand while working; fold away when finished unless the user prefers it open.
  useEffect(() => {
    if (running) setExpanded(true);
    else setExpanded(defaultExpanded || status === 'failed');
  }, [running, status, defaultExpanded]);

  if (!running && steps.length === 0) return null;

  const duration = task?.endedAt ? formatDuration(task.endedAt - task.startedAt) : null;
  const meta = [steps.length ? `${steps.length} step${steps.length === 1 ? '' : 's'}` : null, duration].filter(Boolean).join(' · ');
  const title = running ? 'Working on your request' : status === 'done' ? 'Completed' : status === 'cancelled' ? 'Stopped' : "Couldn't finish";
  const thinkingLabel = steps.length === 0 ? 'Understanding your request' : 'Deciding the next step';
  const waiting = steps.some((s) => s.status === 'waiting');

  return (
    <section className={`activity ${status}`} aria-label="Agent activity">
      <button type="button" className="activity-head" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} aria-controls={listId}>
        <span className={`activity-status ${status}`}>
          {running ? <Sparkle size={13} className="spin-slow" /> : status === 'done' ? <Check size={13} strokeWidth={3} /> : status === 'cancelled' ? <Square size={10} strokeWidth={3} /> : <AlertCircle size={14} strokeWidth={2.5} />}
        </span>
        <span className={`activity-title ${running && !waiting ? 'shimmer' : ''}`}>{waiting ? 'Waiting for your approval' : title}</span>
        {meta && <span className="activity-meta">{meta}</span>}
        <ChevronDown size={15} className={`chev ${expanded ? 'open' : ''}`} aria-hidden />
      </button>
      {expanded && (
        <ol className="steps" id={listId} aria-live="polite">
          {steps.map((s) => (
            <StepRow key={s.id} step={s} developer={developer} />
          ))}
          {running && thinking && (
            <li className="step thinking">
              <span className="step-icon running" aria-hidden />
              <div className="step-body">
                <span className="step-label shimmer">{thinkingLabel}</span>
              </div>
            </li>
          )}
        </ol>
      )}
    </section>
  );
});
