import { Dropdown } from 'antd';
import { Check, ChevronDown, Settings2 } from 'lucide-react';
import type { AgentConfig } from '@/shared/types/config';
import { AgentAvatar } from '../../components/Brand';
import { openConfiguration } from '../../utils/navigation';

interface Props {
  agents: AgentConfig[];
  active: AgentConfig;
  disabled: boolean;
  onChange: (id: string) => void;
}

export function AgentSwitcher({ agents, active, disabled, onChange }: Props) {
  return (
    <Dropdown
      trigger={['click']}
      disabled={disabled}
      placement="bottomLeft"
      overlayClassName="agent-menu"
      menu={{
        selectable: true,
        selectedKeys: [active.id],
        onClick: ({ key }) => (key === '__manage' ? void openConfiguration('/agents') : onChange(key)),
        items: [
          { type: 'group', label: 'Agents' },
          ...agents.map((a) => ({
            key: a.id,
            label: (
              <div className="agent-option">
                <AgentAvatar avatar={a.avatar} size={28} />
                <div className="agent-option-text">
                  <div className="agent-option-name">{a.name}</div>
                  {a.description && <div className="agent-option-desc">{a.description}</div>}
                </div>
                {a.id === active.id && <Check size={15} className="agent-option-check" aria-label="Selected" />}
              </div>
            ),
          })),
          { type: 'divider' },
          { key: '__manage', icon: <Settings2 size={15} />, label: 'Manage agents' },
        ],
      }}
    >
      <button type="button" className="agent-switch" aria-label={`Agent: ${active.name}. Change agent`} disabled={disabled}>
        <AgentAvatar avatar={active.avatar} size={24} />
        <span className="agent-switch-name">{active.name}</span>
        <ChevronDown size={14} className="agent-switch-chev" aria-hidden />
      </button>
    </Dropdown>
  );
}
