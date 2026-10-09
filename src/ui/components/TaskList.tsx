import { AlertCircle, Check, Loader2, Square } from 'lucide-react';
import { memo } from 'react';
import type { TaskRecord } from '@/shared/types/history';
import { formatRelative } from '@/shared/utils';

/** A one-line preview of a Markdown answer: no stars, pipes or table rules. */
const plain = (md: string) =>
  md
    .replace(/\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?/g, ' ')
    .replace(/[*_`#>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function TaskStatusIcon({ status }: { status: TaskRecord['status'] }) {
  const label = { done: 'Completed', failed: 'Failed', cancelled: 'Stopped', running: 'Running' }[status];
  return (
    <span className={`task-icon ${status}`} role="img" aria-label={label}>
      {status === 'done' ? <Check size={12} strokeWidth={3} /> : status === 'failed' ? <AlertCircle size={13} strokeWidth={2.5} /> : status === 'cancelled' ? <Square size={9} strokeWidth={3} /> : <Loader2 size={13} className="spin" />}
    </span>
  );
}

interface Props {
  tasks: TaskRecord[];
  selectedId?: string | null;
  onSelect: (task: TaskRecord) => void;
}

export const TaskList = memo(function TaskList({ tasks, selectedId, onSelect }: Props) {
  return (
    <ul className="task-list">
      {tasks.map((t) => (
        <li key={t.id}>
          <button type="button" className={`task-row ${selectedId === t.id ? 'selected' : ''}`} onClick={() => onSelect(t)}>
            <TaskStatusIcon status={t.status} />
            <span className="task-main">
              <span className="task-request">{t.request}</span>
              <span className="task-meta">
                {t.site}
                <span aria-hidden> · </span>
                {t.agentName}
                <span aria-hidden> · </span>
                {formatRelative(t.startedAt)}
              </span>
              {(t.result || t.error) && <span className={`task-result ${t.status}`}>{t.status === 'done' ? plain(t.result ?? '') : t.error}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
});
