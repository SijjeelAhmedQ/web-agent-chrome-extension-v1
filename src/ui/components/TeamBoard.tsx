import { Button } from 'antd';
import { AlertCircle, Check, Loader2, Pause, Square } from 'lucide-react';
import { memo, useState } from 'react';
import type { AgentConfig } from '@/shared/types/config';
import type { MemberState } from '@/store/chatSlice';
import { ActivityCard } from './Activity';
import { ApprovalCard } from './ApprovalCard';
import { AgentAvatar } from './Brand';

function MemberStatus({ m }: { m: MemberState }) {
  const status = m.task?.status ?? 'running';
  if (m.approval)
    return (
      <span className="pill warning">
        <Pause size={10} /> Needs you
      </span>
    );
  if (status === 'running')
    return (
      <span className="pill">
        <Loader2 size={11} className="spin" /> Working
      </span>
    );
  if (status === 'done')
    return (
      <span className="pill success">
        <Check size={11} /> Done
      </span>
    );
  if (status === 'cancelled')
    return (
      <span className="pill">
        <Square size={9} /> Stopped
      </span>
    );
  return (
    <span className="pill danger">
      <AlertCircle size={11} /> Failed
    </span>
  );
}

const MemberCard = memo(function MemberCard({ m, agent, developer, onRespond }: { m: MemberState; agent?: AgentConfig; developer: boolean; onRespond: (id: string, ok: boolean) => void }) {
  const [showTask, setShowTask] = useState(false);
  const status = m.task?.status ?? 'running';
  return (
    <li className={`member ${status} ${m.approval ? 'waiting' : ''}`}>
      <div className="member-head">
        {agent && <AgentAvatar avatar={agent.avatar} size={22} />}
        <span className="member-name">{agent?.name ?? 'Agent'}</span>
        <MemberStatus m={m} />
      </div>
      <button type="button" className={`member-task ${showTask ? 'open' : ''}`} onClick={() => setShowTask((v) => !v)} aria-expanded={showTask} title="Show the full task">
        {m.assignment}
      </button>
      <ActivityCard task={m.task} thinking={m.thinking} developer={developer} defaultExpanded={false} />
      {m.approval && <ApprovalCard prompt={m.approval} onRespond={(ok) => onRespond(m.approval!.id, ok)} />}
      {status === 'done' && m.task?.result && <div className="member-result">{m.task.result}</div>}
      {status === 'failed' && m.task?.error && <div className="member-result error">{m.task.error}</div>}
    </li>
  );
});

/** The members of a team turn, each with its own live activity and approvals. */
export function TeamBoard({ members, agents, developer, onRespond }: { members: MemberState[]; agents: AgentConfig[]; developer: boolean; onRespond: (id: string, ok: boolean) => void }) {
  const pending = members.filter((m) => m.approval);
  const working = members.filter((m) => (m.task?.status ?? 'running') === 'running').length;
  return (
    <section className="team" aria-label="Team members">
      <div className="team-head">
        <span>{working ? `${working} of ${members.length} agents working` : `${members.length} agents`}</span>
        {pending.length > 1 && (
          <Button size="small" type="primary" onClick={() => pending.forEach((m) => onRespond(m.approval!.id, true))}>
            Approve all {pending.length}
          </Button>
        )}
      </div>
      <ul className="team-list">
        {members.map((m) => (
          <MemberCard key={m.key} m={m} agent={agents.find((a) => a.id === m.agentId)} developer={developer} onRespond={onRespond} />
        ))}
      </ul>
    </section>
  );
}
