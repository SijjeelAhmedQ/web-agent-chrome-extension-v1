import { Button, Tooltip } from 'antd';
import { AlertCircle, Check, Copy, RotateCcw } from 'lucide-react';
import { memo, useState } from 'react';
import { errorTitle, recoveryFor, type ErrorCode } from '@/shared/utils/errors';
import type { AgentConfig } from '@/shared/types/config';
import type { Turn } from '@/store/chatSlice';
import { ActivityCard } from '../../components/Activity';
import { ApprovalCard } from '../../components/ApprovalCard';
import { AgentAvatar } from '../../components/Brand';
import { Markdown } from '../../components/Markdown';
import { TeamBoard } from '../../components/TeamBoard';
import { openConfiguration } from '../../utils/navigation';

interface Props {
  turn: Turn;
  agent: AgentConfig | undefined;
  agents: AgentConfig[];
  showAgent: boolean;
  developer: boolean;
  expandActivity: boolean;
  isLast: boolean;
  /** The agent is working: a request can't be run again until it's done. */
  busy: boolean;
  onRespond: (approvalId: string, approved: boolean) => void;
  onRetry: (request: string) => void;
}

function CopyButton({ text, label = 'Copy answer' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Tooltip title={copied ? 'Copied' : 'Copy'} mouseEnterDelay={0.3}>
      <button
        type="button"
        className="icon-btn small"
        aria-label={label}
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          });
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </Tooltip>
  );
}

export const TurnView = memo(function TurnView({ turn, agent, agents, showAgent, developer, expandActivity, isLast, busy, onRespond, onRetry }: Props) {
  const task = turn.task;
  const status = task?.status ?? 'running';
  const code = (task?.errorCode ?? 'unknown') as ErrorCode;

  return (
    <article className="turn" aria-label="Conversation turn">
      <div className="user-msg">
        <div className="bubble">{turn.request}</div>
        <div className="request-actions">
          <CopyButton text={turn.request} label="Copy request" />
          <Tooltip title={busy ? 'Wait until the agent is done' : 'Run again'} mouseEnterDelay={0.3}>
            <button type="button" className="icon-btn small" aria-label="Run this request again" disabled={busy} onClick={() => onRetry(turn.request)}>
              <RotateCcw size={14} />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="agent-msg">
        {showAgent && agent && (
          <div className="agent-tag">
            <AgentAvatar avatar={agent.avatar} size={18} />
            <span>{agent.name}</span>
          </div>
        )}

        <ActivityCard task={task} thinking={turn.thinking} developer={developer} defaultExpanded={expandActivity} />

        {turn.approval && <ApprovalCard prompt={turn.approval} onRespond={(ok) => onRespond(turn.approval!.id, ok)} />}

        {turn.members && turn.members.length > 0 && <TeamBoard members={turn.members} agents={agents} developer={developer} onRespond={onRespond} />}

        {status === 'done' && task?.result && (
          <div className="answer">
            <Markdown text={task.result} />
            <div className="answer-actions">
              <CopyButton text={task.result} />
            </div>
          </div>
        )}

        {status === 'failed' && (
          <div className="notice error" role="alert">
            <AlertCircle size={16} className="notice-icon" aria-hidden />
            <div className="notice-body">
              <div className="notice-title">{errorTitle(code)}</div>
              <div className="notice-text">{task?.error}</div>
              {developer && task?.errorDetail && <pre className="step-detail mono">{task.errorDetail}</pre>}
              <div className="notice-actions">
                {recoveryFor(code).map((action) =>
                  action === 'retry' ? (
                    isLast && (
                      <Button key={action} size="small" icon={<RotateCcw size={13} />} onClick={() => onRetry(turn.request)}>
                        Try again
                      </Button>
                    )
                  ) : action === 'open-models' ? (
                    <Button key={action} size="small" type={code === 'no_model' ? 'primary' : 'default'} onClick={() => void openConfiguration('/models')}>
                      {code === 'no_model' ? 'Connect a model' : 'Check model settings'}
                    </Button>
                  ) : action === 'open-permissions' ? (
                    <Button key={action} size="small" onClick={() => void openConfiguration('/permissions')}>
                      Site permissions
                    </Button>
                  ) : null,
                )}
              </div>
            </div>
          </div>
        )}

        {status === 'cancelled' && (
          <div className="notice quiet">
            <span>{task?.error?.startsWith('Interrupted') ? task.error : 'Stopped. You’re in control.'}</span>
            {isLast && (
              <button type="button" className="link-btn" onClick={() => onRetry(turn.request)}>
                Run again
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
});
