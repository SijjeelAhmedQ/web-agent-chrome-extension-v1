import { App, Button, Checkbox, Drawer, Input, Popover, Segmented, Select, Switch } from 'antd';
import { Plus, Trash2, Webhook, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { TOOL_NAME_PATTERN } from '@/agent/tools/customTools';
import { BUILT_IN_TOOLS, CUSTOM_PREFIX, TOOL_CATEGORIES, type ToolCategory } from '@/shared/constants/tools';
import type { AgentConfig, CustomToolConfig, CustomToolParam } from '@/shared/types/config';
import { uid } from '@/shared/utils';
import { useAppDispatch, useAppSelector } from '@/store';
import { configActions } from '@/store/configSlice';
import { AgentAvatar } from '../../components/Brand';
import { NamedIcon } from '../../components/icons';
import { AvatarStack, EmptyBlock, FieldLabel, PageHeader, Section } from './parts';

const RISK = {
  read: { label: 'Reads only', cls: '' },
  action: { label: 'Changes the page', cls: '' },
  sensitive: { label: 'May ask first', cls: 'warning' },
} as const;

/** Lets the user assign a tool to agents right from the tools list. */
function AssignPopover({ toolId, agents }: { toolId: string; agents: AgentConfig[] }) {
  const dispatch = useAppDispatch();
  const users = agents.filter((a) => a.toolIds.includes(toolId));
  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      title="Agents with this tool"
      content={
        <div className="assign-list">
          {agents.map((a) => (
            <label key={a.id} className="check-row compact">
              <Checkbox checked={a.toolIds.includes(toolId)} onChange={(e) => dispatch(configActions.toggleToolForAgent({ agentId: a.id, toolId, on: e.target.checked }))} />
              <AgentAvatar avatar={a.avatar} size={20} />
              <span className="check-title">{a.name}</span>
            </label>
          ))}
        </div>
      }
    >
      <button type="button" className="assign-btn" aria-label={`Assign to agents (${users.length} assigned)`} onClick={(e) => e.stopPropagation()}>
        <AvatarStack agents={users} max={3} />
      </button>
    </Popover>
  );
}

export function ToolsPage() {
  const { agents, customTools, settings } = useAppSelector((s) => s.config.config);
  const dispatch = useAppDispatch();
  const { modal, message } = App.useApp();
  const [editing, setEditing] = useState<{ tool: CustomToolConfig; isNew: boolean } | null>(null);

  const setEnabled = (id: string, on: boolean) =>
    dispatch(configActions.updateSettings({ disabledToolIds: on ? settings.disabledToolIds.filter((t) => t !== id) : [...settings.disabledToolIds, id] }));

  const newTool = (): CustomToolConfig => {
    const now = Date.now();
    return { id: uid('tool_'), name: '', label: '', description: '', method: 'POST', url: '', headers: '', params: [], needsApproval: true, createdAt: now, updatedAt: now };
  };

  return (
    <>
      <PageHeader
        title="Tools"
        description="What agents can do. Built-in browser tools work on any website; custom tools connect agents to your own services."
        actions={
          <Button icon={<Plus size={16} />} onClick={() => setEditing({ tool: newTool(), isNew: true })}>
            New custom tool
          </Button>
        }
      />

      {(Object.keys(TOOL_CATEGORIES) as ToolCategory[]).map((cat) => (
        <Section key={cat} title={TOOL_CATEGORIES[cat].label} description={TOOL_CATEGORIES[cat].description}>
          {BUILT_IN_TOOLS.filter((t) => t.category === cat).map((t) => {
            const on = !settings.disabledToolIds.includes(t.id);
            return (
              <div key={t.id} className={`tool-row ${on ? '' : 'is-off'}`}>
                <span className="list-icon">
                  <NamedIcon name={t.icon} size={16} />
                </span>
                <span className="list-main">
                  <span className="list-title">
                    {t.label} {settings.developerMode && <span className="mono muted small">{t.id}</span>}
                  </span>
                  <span className="list-desc">{t.description}</span>
                </span>
                <span className="list-side">
                  <span className={`pill ${RISK[t.risk].cls}`}>{RISK[t.risk].label}</span>
                  <AssignPopover toolId={t.id} agents={agents} />
                  <Switch size="small" checked={on} onChange={(v) => setEnabled(t.id, v)} aria-label={`${t.label} ${on ? 'on' : 'off'} for all agents`} />
                </span>
              </div>
            );
          })}
        </Section>
      ))}

      <Section title="Custom tools" description="Call your own HTTP endpoints — a backend, an automation webhook, an internal API.">
        {customTools.length === 0 ? (
          <EmptyBlock icon={<Webhook size={20} />} title="No custom tools" text="Give agents new abilities by connecting an endpoint." action={<Button onClick={() => setEditing({ tool: newTool(), isNew: true })}>Create a tool</Button>} />
        ) : (
          customTools.map((t) => (
            <div key={t.id} className="tool-row clickable" role="button" tabIndex={0} onClick={() => setEditing({ tool: t, isNew: false })} onKeyDown={(e) => e.key === 'Enter' && setEditing({ tool: t, isNew: false })}>
              <span className="list-icon">
                <Webhook size={16} />
              </span>
              <span className="list-main">
                <span className="list-title">{t.label || t.name}</span>
                <span className="list-desc">
                  <span className="mono">{t.method}</span> {safeHost(t.url)} · {t.description}
                </span>
              </span>
              <span className="list-side" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                {t.needsApproval && <span className="pill warning">Asks first</span>}
                <AssignPopover toolId={`${CUSTOM_PREFIX}${t.id}`} agents={agents} />
              </span>
            </div>
          ))
        )}
      </Section>

      <CustomToolEditor
        value={editing}
        existingNames={new Set([...BUILT_IN_TOOLS.map((t) => t.id), 'load_skill', ...customTools.filter((t) => t.id !== editing?.tool.id).map((t) => t.name)])}
        onClose={() => setEditing(null)}
        onSave={(tool, agentIds) => {
          dispatch(configActions.upsertCustomTool({ tool, agentIds }));
          message.success(editing?.isNew ? 'Tool created' : 'Changes saved');
          setEditing(null);
        }}
        onDelete={(tool) =>
          modal.confirm({
            title: `Delete “${tool.label || tool.name}”?`,
            content: 'Agents will no longer be able to use it.',
            okText: 'Delete',
            okButtonProps: { danger: true },
            onOk: () => {
              dispatch(configActions.deleteCustomTool(tool.id));
              setEditing(null);
            },
          })
        }
      />
    </>
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url || 'no address';
  }
}

const toIdentifier = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 't_$1')
    .slice(0, 48);

interface EditorProps {
  value: { tool: CustomToolConfig; isNew: boolean } | null;
  existingNames: Set<string>;
  onClose: () => void;
  onSave: (tool: CustomToolConfig, agentIds: string[]) => void;
  onDelete: (tool: CustomToolConfig) => void;
}

function CustomToolEditor({ value, existingNames, onClose, onSave, onDelete }: EditorProps) {
  const agents = useAppSelector((s) => s.config.config.agents);
  const [draft, setDraft] = useState<CustomToolConfig | null>(null);
  const [assigned, setAssigned] = useState<string[]>([]);
  const [nameTouched, setNameTouched] = useState(false);

  useEffect(() => {
    if (!value) return;
    setDraft(structuredClone(value.tool));
    setNameTouched(!value.isNew);
    const key = `${CUSTOM_PREFIX}${value.tool.id}`;
    setAssigned(agents.filter((a) => a.toolIds.includes(key)).map((a) => a.id));
    // Only when a different tool is opened — not on every config change.
  }, [value]);

  if (!draft || !value) return <Drawer open={false} />;
  const set = (patch: Partial<CustomToolConfig>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setParam = (i: number, patch: Partial<CustomToolParam>) => set({ params: draft.params.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  let urlOk = false;
  try {
    urlOk = /^https?:$/.test(new URL(draft.url).protocol);
  } catch {
    urlOk = false;
  }
  const nameOk = TOOL_NAME_PATTERN.test(draft.name) && !existingNames.has(draft.name);
  const paramsOk = draft.params.every((p) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(p.name)) && new Set(draft.params.map((p) => p.name)).size === draft.params.length;
  const valid = draft.label.trim() && draft.description.trim() && urlOk && nameOk && paramsOk;

  return (
    <Drawer
      open
      onClose={onClose}
      width={640}
      title={value.isNew ? 'New custom tool' : draft.label || draft.name}
      footer={
        <div className="drawer-foot">
          {!value.isNew && (
            <Button danger type="text" icon={<Trash2 size={14} />} onClick={() => onDelete(value.tool)}>
              Delete
            </Button>
          )}
          <span className="spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" disabled={!valid} onClick={() => onSave({ ...draft, label: draft.label.trim(), description: draft.description.trim() }, assigned)}>
            {value.isNew ? 'Create tool' : 'Save changes'}
          </Button>
        </div>
      }
    >
      <div className="form-stack">
        <div className="two-col">
          <div>
            <FieldLabel htmlFor="tool-label">Name</FieldLabel>
            <Input
              id="tool-label"
              value={draft.label}
              placeholder="e.g. Look up patient"
              onChange={(e) => set({ label: e.target.value, ...(nameTouched ? {} : { name: toIdentifier(e.target.value) }) })}
              autoFocus={value.isNew}
            />
          </div>
          <div>
            <FieldLabel htmlFor="tool-id" hint="What the model calls">
              Identifier
            </FieldLabel>
            <Input
              id="tool-id"
              className="mono"
              value={draft.name}
              status={draft.name && !nameOk ? 'error' : undefined}
              onChange={(e) => {
                setNameTouched(true);
                set({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') });
              }}
              placeholder="lookup_patient"
            />
            {draft.name && !nameOk && <div className="field-error">{existingNames.has(draft.name) ? 'Another tool already uses this identifier.' : 'Use lowercase letters, numbers and underscores.'}</div>}
          </div>
        </div>
        <div>
          <FieldLabel htmlFor="tool-desc" hint="Tells the agent when and how to use it">
            Description
          </FieldLabel>
          <Input.TextArea id="tool-desc" value={draft.description} onChange={(e) => set({ description: e.target.value })} autoSize={{ minRows: 2, maxRows: 5 }} placeholder="Finds a patient by name and returns their ID and date of birth." />
        </div>
        <div>
          <FieldLabel>Endpoint</FieldLabel>
          <div className="row-gap">
            <Segmented<'GET' | 'POST'> value={draft.method} onChange={(v) => set({ method: v })} options={['GET', 'POST']} />
            <Input value={draft.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://api.example.com/lookup" status={draft.url && !urlOk ? 'error' : undefined} />
          </div>
          <div className="field-help">{draft.method === 'GET' ? 'Arguments are sent as query parameters.' : 'Arguments are sent as a JSON body.'}</div>
        </div>
        <div>
          <FieldLabel htmlFor="tool-headers" hint="Optional · one per line">
            Headers
          </FieldLabel>
          <Input.TextArea id="tool-headers" className="mono-area" value={draft.headers} onChange={(e) => set({ headers: e.target.value })} autoSize={{ minRows: 2, maxRows: 6 }} placeholder="Authorization: Bearer …" />
          <div className="field-help">Stored only in this browser.</div>
        </div>
        <div>
          <FieldLabel>Parameters</FieldLabel>
          <div className="param-list">
            {draft.params.map((p, i) => (
              <div key={i} className="param-row">
                <Input className="mono" value={p.name} onChange={(e) => setParam(i, { name: e.target.value.replace(/\s/g, '_') })} placeholder="name" aria-label="Parameter name" />
                <Select value={p.type} onChange={(v) => setParam(i, { type: v })} options={['string', 'number', 'boolean'].map((t) => ({ value: t, label: t }))} style={{ width: 110 }} aria-label="Type" />
                <Input value={p.description} onChange={(e) => setParam(i, { description: e.target.value })} placeholder="What it is" aria-label="Parameter description" />
                <Checkbox checked={p.required} onChange={(e) => setParam(i, { required: e.target.checked })}>
                  Required
                </Checkbox>
                <button type="button" className="icon-btn" aria-label="Remove parameter" onClick={() => set({ params: draft.params.filter((_, j) => j !== i) })}>
                  <X size={15} />
                </button>
              </div>
            ))}
            <Button type="dashed" icon={<Plus size={14} />} onClick={() => set({ params: [...draft.params, { name: '', type: 'string', description: '', required: true }] })}>
              Add parameter
            </Button>
            {!paramsOk && <div className="field-error">Parameter names must be unique and use letters, numbers or underscores.</div>}
          </div>
        </div>
        <div className="setting-row bare">
          <div className="setting-text">
            <div className="setting-label">Ask before each use</div>
            <div className="setting-desc">Recommended for tools that change data or send messages.</div>
          </div>
          <Switch checked={draft.needsApproval} onChange={(v) => set({ needsApproval: v })} aria-label="Ask before each use" />
        </div>
        <div>
          <FieldLabel>Agents with this tool</FieldLabel>
          <div className="check-list">
            {agents.map((a) => (
              <label key={a.id} className="check-row compact">
                <Checkbox checked={assigned.includes(a.id)} onChange={(e) => setAssigned((ids) => (e.target.checked ? [...ids, a.id] : ids.filter((x) => x !== a.id)))} />
                <AgentAvatar avatar={a.avatar} size={22} />
                <span className="check-title">{a.name}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </Drawer>
  );
}
