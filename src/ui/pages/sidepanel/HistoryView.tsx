import { Button, Segmented } from 'antd';
import { ArrowLeft, ExternalLink, History } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { TaskRecord } from '@/shared/types/history';
import { formatRelative } from '@/shared/utils';
import { useAppSelector } from '@/store';
import { ActivityCard } from '../../components/Activity';
import { IconButton } from '../../components/IconButton';
import { Markdown } from '../../components/Markdown';
import { TaskList, TaskStatusIcon } from '../../components/TaskList';
import { openConfiguration } from '../../utils/navigation';

type Filter = 'all' | 'done' | 'failed' | 'cancelled';

export function HistoryView({ onBack, onRunAgain }: { onBack: () => void; onRunAgain: (request: string) => void }) {
  const tasks = useAppSelector((s) => s.history.tasks);
  const saveHistory = useAppSelector((s) => s.config.config.settings.saveHistory);
  const developer = useAppSelector((s) => s.config.config.settings.developerMode);
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<TaskRecord | null>(null);

  const visible = useMemo(() => (filter === 'all' ? tasks : tasks.filter((t) => t.status === filter)), [tasks, filter]);
  const live = selected ? tasks.find((t) => t.id === selected.id) ?? selected : null;

  if (live) {
    return (
      <div className="view">
        <div className="view-head">
          <IconButton label="Back to activity" onClick={() => setSelected(null)}>
            <ArrowLeft size={17} />
          </IconButton>
          <span className="view-title">Task</span>
        </div>
        <div className="view-scroll detail">
          <div className="detail-request">{live.request}</div>
          <div className="detail-meta">
            <TaskStatusIcon status={live.status} />
            <span>
              {live.site} · {live.agentName} · {formatRelative(live.startedAt)}
            </span>
          </div>
          <ActivityCard task={live} thinking={false} developer={developer} defaultExpanded />
          {live.status === 'done' && live.result && (
            <div className="answer">
              <Markdown text={live.result} />
            </div>
          )}
          {live.error && live.status !== 'done' && <div className="notice quiet">{live.error}</div>}
          <div className="detail-actions">
            <Button onClick={() => onRunAgain(live.request)}>Run again</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="view">
      <div className="view-head">
        <IconButton label="Back to chat" onClick={onBack}>
          <ArrowLeft size={17} />
        </IconButton>
        <span className="view-title">Activity</span>
        <span className="spacer" />
        <IconButton label="Open full activity" onClick={() => void openConfiguration('/activity')}>
          <ExternalLink size={15} />
        </IconButton>
      </div>
      <div className="view-filter">
        <Segmented<Filter>
          block
          size="small"
          value={filter}
          onChange={setFilter}
          options={[
            { label: 'All', value: 'all' },
            { label: 'Done', value: 'done' },
            { label: 'Failed', value: 'failed' },
            { label: 'Stopped', value: 'cancelled' },
          ]}
        />
      </div>
      <div className="view-scroll">
        {visible.length ? (
          <TaskList tasks={visible} onSelect={setSelected} />
        ) : (
          <div className="empty-list">
            <History size={22} aria-hidden />
            <div className="empty-list-title">{tasks.length ? 'Nothing here' : 'No activity yet'}</div>
            <div className="empty-list-text">{saveHistory ? 'Tasks you run will show up here.' : 'Activity history is turned off in Privacy settings.'}</div>
          </div>
        )}
      </div>
    </div>
  );
}
