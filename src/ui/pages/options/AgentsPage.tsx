import { App, Button, Dropdown } from 'antd';
import { ChevronDown, Copy, MoreHorizontal, Plus, Star, Stethoscope, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { DEFAULT_AGENTS } from '@/shared/constants/defaults';
import { careflowTeam } from '@/shared/constants/templates';
import type { AgentConfig } from '@/shared/types/config';
import { uid } from '@/shared/utils';
import { useAppDispatch, useAppSelector } from '@/store';
import { configActions } from '@/store/configSlice';
import { AgentAvatar } from '../../components/Brand';
import { AgentEditor } from './AgentEditor';
import { PageHeader } from './parts';

const POLICY_LABEL = { smart: 'Asks before important actions', always: 'Asks before every action', never: 'Acts without asking' } as const;

export function AgentsPage() {
  const { agents, providers, settings, skills, customTools } = useAppSelector((s) => s.config.config);
  const dispatch = useAppDispatch();
  const { modal, message } = App.useApp();
  const [editing, setEditing] = useState<AgentConfig | null>(null);
  const [isNew, setIsNew] = useState(false);

  const create = () => {
    const now = Date.now();
    setIsNew(true);
    setEditing({
      ...structuredClone(DEFAULT_AGENTS[0]),
      id: uid('agent_'),
      name: '',
      description: '',
      avatar: { icon: 'Bot', color: '#8b5cf6' },
      skillIds: [],
      createdAt: now,
      updatedAt: now,
    });
  };

  const addCareflowTeam = () => {
    const kaggle = providers.find((p) => p.preset === 'kaggle');
    const { skill, agents: members, coordinator } = careflowTeam(kaggle?.id ?? null);
    dispatch(configActions.upsertSkill({ skill }));
    for (const a of [...members, coordinator]) dispatch(configActions.upsertAgent(a));
    message.success(`Added the CareFlow team: ${members.length} specialists and a coordinator${kaggle ? `, using ${kaggle.name}` : ''}`);
  };

  const modelLabel = (a: AgentConfig) => {
    const p = providers.find((x) => x.id === a.providerId) ?? providers.find((x) => x.id === settings.defaultProviderId) ?? providers[0];
    if (!p) return 'No model connected';
    return a.model || p.defaultModel || p.name;
  };

  return (
    <>
      <PageHeader
        title="Agents"
        description="Each agent has its own instructions, model, tools and skills. Pick one from the side panel."
        actions={
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: [
                { key: 'blank', icon: <Plus size={15} />, label: 'Blank agent' },
                { type: 'divider' },
                { type: 'group', label: 'Templates' },
                {
                  key: 'careflow',
                  icon: <Stethoscope size={15} />,
                  label: (
                    <div className="menu-two-line">
                      <span>CareFlow team</span>
                      <span className="muted small">Medication, Diagnosis, Task, Recall and Appointment agents working at the same time</span>
                    </div>
                  ),
                },
              ],
              onClick: ({ key }) => (key === 'careflow' ? addCareflowTeam() : create()),
            }}
          >
            <Button type="primary" icon={<Plus size={16} />}>
              New agent <ChevronDown size={14} />
            </Button>
          </Dropdown>
        }
      />

      <div className="card-grid">
        {agents.map((a) => {
          const toolCount = a.toolIds.filter((id) => !id.startsWith('custom:') || customTools.some((t) => `custom:${t.id}` === id)).length;
          const skillCount = a.skillIds.filter((id) => skills.some((s) => s.id === id)).length;
          return (
            <div
              key={a.id}
              className="agent-card"
              style={{ ['--agent' as string]: a.avatar.color }}
              role="button"
              tabIndex={0}
              onClick={() => {
                setIsNew(false);
                setEditing(a);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setIsNew(false);
                  setEditing(a);
                }
              }}
              aria-label={`Edit ${a.name}`}
            >
              <div className="agent-card-top">
                <AgentAvatar avatar={a.avatar} size={40} />
                <div className="agent-card-name">
                  <span>{a.name}</span>
                </div>
                <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                  <Dropdown
                    trigger={['click']}
                    menu={{
                      items: [
                        { key: 'default', icon: <Star size={14} />, label: 'Make default', disabled: settings.defaultAgentId === a.id },
                        { key: 'duplicate', icon: <Copy size={14} />, label: 'Duplicate' },
                        { type: 'divider' },
                        { key: 'delete', icon: <Trash2 size={14} />, label: 'Delete', danger: true, disabled: agents.length <= 1 },
                      ],
                      onClick: ({ key }) => {
                        if (key === 'default') dispatch(configActions.updateSettings({ defaultAgentId: a.id }));
                        if (key === 'duplicate') {
                          const now = Date.now();
                          dispatch(configActions.upsertAgent({ ...structuredClone(a), id: uid('agent_'), name: `${a.name} copy`, createdAt: now, updatedAt: now }));
                          message.success('Agent duplicated');
                        }
                        if (key === 'delete') {
                          modal.confirm({
                            title: `Delete “${a.name}”?`,
                            content: 'Its settings will be removed. Skills and tools stay available to other agents.',
                            okText: 'Delete',
                            okButtonProps: { danger: true },
                            onOk: () => {
                              dispatch(configActions.deleteAgent(a.id));
                            },
                          });
                        }
                      },
                    }}
                  >
                    <button type="button" className="icon-btn" aria-label={`More actions for ${a.name}`}>
                      <MoreHorizontal size={16} />
                    </button>
                  </Dropdown>
                </div>
              </div>
              <p className="agent-card-desc">{a.description || 'No description'}</p>
              <div className="agent-card-meta">
                {settings.defaultAgentId === a.id && <span className="pill success">Default</span>}
                {a.team?.memberIds.length ? (
                  <span className="pill success">
                    <Users size={11} /> Team · {a.team.memberIds.length}
                    {a.team.parallel ? ' at once' : ''}
                  </span>
                ) : null}
                <span className="pill">{modelLabel(a)}</span>
                <span className="pill">
                  {toolCount} tool{toolCount === 1 ? '' : 's'}
                </span>
                <span className="pill">
                  {skillCount} skill{skillCount === 1 ? '' : 's'}
                </span>
              </div>
              <div className="agent-card-foot">{POLICY_LABEL[a.confirmation]}</div>
            </div>
          );
        })}
        <button type="button" className="agent-card add" onClick={create}>
          <span className="add-icon">
            <Plus size={18} />
          </span>
          <span>Create an agent</span>
          <span className="muted small">For a site, a workflow or a team</span>
        </button>
      </div>

      <AgentEditor
        agent={editing}
        isNew={isNew}
        onClose={() => setEditing(null)}
        onSave={(agent) => {
          dispatch(configActions.upsertAgent(agent));
          message.success(isNew ? 'Agent created' : 'Changes saved');
          setEditing(null);
        }}
      />
    </>
  );
}
