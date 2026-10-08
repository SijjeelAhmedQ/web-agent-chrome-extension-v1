import { App, Button, Input, Segmented } from 'antd';
import { History, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { deleteTask } from '@/shared/storage/historyStore';
import type { TaskRecord } from '@/shared/types/history';
import { formatDuration } from '@/shared/utils';
import { useAppSelector } from '@/store';
import { ActivityCard } from '../../components/Activity';
import { Markdown } from '../../components/Markdown';
import { TaskList, TaskStatusIcon } from '../../components/TaskList';
import { EmptyBlock, PageHeader } from './parts';

type Filter = 'all' | 'running' | 'done' | 'failed' | 'cancelled';

export function ActivityPage() {
  const tasks = useAppSelector((s) => s.history.tasks);
  const { developerMode, saveHistory } = useAppSelector((s) => s.config.config.settings);
  const { message } = App.useApp();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((t) => (filter === 'all' || t.status === filter) && (!q || `${t.request} ${t.site} ${t.agentName} ${t.result ?? ''}`.toLowerCase().includes(q)));
  }, [tasks, filter, query]);

  const selected: TaskRecord | undefined = tasks.find((t) => t.id === selectedId) ?? visible[0];
  const counts = useMemo(() => {
    const c = { running: 0, done: 0, failed: 0, cancelled: 0 };
    for (const t of tasks) c[t.status]++;
    return c;
  }, [tasks]);

  return (
    <>
      <PageHeader title="Activity" description={saveHistory ? 'Everything your agents have done, newest first.' : 'Saving activity is off — turn it on in Privacy to keep a record of tasks.'} />
      {tasks.length === 0 ? (
        <EmptyBlock icon={<History size={22} />} title="No activity yet" text="Tasks you run from the side panel will appear here." />
      ) : (
        <div className="activity-layout">
          <div className="activity-list-pane">
            <div className="activity-tools">
              <Input allowClear prefix={<Search size={14} className="muted" />} placeholder="Search tasks" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search tasks" />
              <Segmented<Filter>
                size="small"
                block
                value={filter}
                onChange={setFilter}
                options={[
                  { label: 'All', value: 'all' },
                  ...(counts.running ? [{ label: `Running ${counts.running}`, value: 'running' as const }] : []),
                  { label: `Done ${counts.done}`, value: 'done' },
                  { label: `Failed ${counts.failed}`, value: 'failed' },
                  { label: `Stopped ${counts.cancelled}`, value: 'cancelled' },
                ]}
              />
            </div>
            <div className="activity-list-scroll">{visible.length ? <TaskList tasks={visible} selectedId={selected?.id} onSelect={(t) => setSelectedId(t.id)} /> : <div className="muted small pad">No tasks match.</div>}</div>
          </div>
          <div className="activity-detail-pane">
            {selected ? (
              <div className="detail">
                <div className="detail-request">{selected.request}</div>
                <div className="detail-meta">
                  <TaskStatusIcon status={selected.status} />
                  <span>
                    {selected.site} · {selected.agentName} · {new Date(selected.startedAt).toLocaleString()}
                    {selected.endedAt ? ` · ${formatDuration(selected.endedAt - selected.startedAt)}` : ''}
                  </span>
                </div>
                {selected.url && (
                  <a className="detail-url" href={selected.url} target="_blank" rel="noreferrer">
                    {selected.title || selected.url}
                  </a>
                )}
                <ActivityCard task={selected} thinking={false} developer={developerMode} defaultExpanded />
                {selected.status === 'done' && selected.result && (
                  <div className="answer">
                    <Markdown text={selected.result} />
                  </div>
                )}
                {selected.error && selected.status !== 'done' && <div className="notice quiet">{selected.error}</div>}
                {developerMode && selected.errorDetail && <pre className="step-detail mono">{selected.errorDetail}</pre>}
                <div className="detail-actions">
                  <Button
                    type="text"
                    danger
                    icon={<Trash2 size={14} />}
                    onClick={async () => {
                      await deleteTask(selected.id);
                      setSelectedId(null);
                      message.success('Task removed');
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ) : (
              <div className="muted pad">Select a task to see its steps.</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
