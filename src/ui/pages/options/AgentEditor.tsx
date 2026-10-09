import { AutoComplete, Button, Checkbox, Drawer, Input, InputNumber, Select, Slider, Switch, Tabs, Tooltip } from 'antd';
import { RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/agent/llm';
import { AGENT_COLORS, AGENT_ICONS } from '@/shared/constants/defaults';
import { BUILT_IN_TOOLS, CUSTOM_PREFIX, TOOL_CATEGORIES, type ToolCategory } from '@/shared/constants/tools';
import { knownModel, presetById } from '@/shared/constants/providers';
import type { AgentConfig, ConfirmationPolicy } from '@/shared/types/config';
import { toAgentError } from '@/shared/utils/errors';
import { useAppSelector } from '@/store';
import { AgentAvatar } from '../../components/Brand';
import { NamedIcon } from '../../components/icons';
import { FieldLabel } from './parts';

interface Props {
  agent: AgentConfig | null;
  isNew: boolean;
  onClose: () => void;
  onSave: (agent: AgentConfig) => void;
}

const RISK_PILL = {
  read: { label: 'Reads only', cls: '' },
  action: { label: 'Changes the page', cls: '' },
  sensitive: { label: 'May ask first', cls: 'warning' },
} as const;

const POLICIES: { value: ConfirmationPolicy; title: string; text: string }[] = [
  { value: 'smart', title: 'Ask before important actions', text: 'Purchases, sending, deleting, submitting forms and entering passwords need your OK. Recommended.' },
  { value: 'always', title: 'Ask before every action', text: 'Every click, typing and change waits for your approval. Reading and navigating don’t.' },
  { value: 'never', title: 'Don’t ask', text: 'The agent acts on its own. Use only with sites and tasks you trust.' },
];

export function AgentEditor({ agent, isNew, onClose, onSave }: Props) {
  const { providers, skills, customTools, settings, agents } = useAppSelector((s) => s.config.config);
  const [draft, setDraft] = useState<AgentConfig | null>(agent);
  const [tab, setTab] = useState('profile');
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(agent ? structuredClone(agent) : null);
    setTab('profile');
    setModels([]);
    setModelError(null);
  }, [agent]);

  const provider = useMemo(() => {
    if (!draft) return undefined;
    return providers.find((p) => p.id === draft.providerId) ?? providers.find((p) => p.id === settings.defaultProviderId) ?? providers[0];
  }, [draft, providers, settings.defaultProviderId]);

  if (!draft) return <Drawer open={false} />;

  const set = (patch: Partial<AgentConfig>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const toggleTool = (id: string, on: boolean) => set({ toolIds: on ? [...new Set([...draft.toolIds, id])] : draft.toolIds.filter((t) => t !== id) });
  const toggleSkill = (id: string, on: boolean) => set({ skillIds: on ? [...new Set([...draft.skillIds, id])] : draft.skillIds.filter((t) => t !== id) });

  const loadModels = async () => {
    if (!provider) return;
    setLoadingModels(true);
    setModelError(null);
    try {
      setModels(await createClient(provider).listModels());
    } catch (err) {
      setModelError(toAgentError(err).userMessage);
    } finally {
      setLoadingModels(false);
    }
  };

  const categories = Object.keys(TOOL_CATEGORIES) as ToolCategory[];
  const toolCount = draft.toolIds.length;
  const valid = draft.name.trim().length > 0;

  return (
    <Drawer
      open={!!agent}
      onClose={onClose}
      width={620}
      title={
        <div className="drawer-title">
          <AgentAvatar avatar={draft.avatar} size={30} />
          <span>{isNew ? 'New agent' : draft.name || 'Agent'}</span>
        </div>
      }
      destroyOnClose
      footer={
        <div className="drawer-foot">
          <span className="muted small">{!valid ? 'Give your agent a name to save it.' : ''}</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="primary"
            disabled={!valid}
            onClick={() => onSave({ ...draft, name: draft.name.trim(), description: draft.description.trim(), team: draft.team?.memberIds.length ? draft.team : undefined })}
          >
            {isNew ? 'Create agent' : 'Save changes'}
          </Button>
        </div>
      }
    >
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'profile',
            label: 'Profile',
            children: (
              <div className="form-stack">
                <div>
                  <FieldLabel>Look</FieldLabel>
                  <div className="avatar-picker">
                    <AgentAvatar avatar={draft.avatar} size={52} />
                    <div className="avatar-options">
                      <div className="swatches" role="radiogroup" aria-label="Color">
                        {AGENT_COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            role="radio"
                            aria-checked={draft.avatar.color === c}
                            aria-label={`Color ${c}`}
                            className={`swatch ${draft.avatar.color === c ? 'on' : ''}`}
                            style={{ background: c }}
                            onClick={() => set({ avatar: { ...draft.avatar, color: c } })}
                          />
                        ))}
                      </div>
                      <div className="icon-grid" role="radiogroup" aria-label="Icon">
                        {AGENT_ICONS.map((i) => (
                          <button
                            key={i}
                            type="button"
                            role="radio"
                            aria-checked={draft.avatar.icon === i}
                            aria-label={i}
                            className={`icon-choice ${draft.avatar.icon === i ? 'on' : ''}`}
                            onClick={() => set({ avatar: { ...draft.avatar, icon: i } })}
                          >
                            <NamedIcon name={i} size={16} />
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <div>
                  <FieldLabel htmlFor="agent-name">Name</FieldLabel>
                  <Input id="agent-name" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Shopping helper" maxLength={40} autoFocus={isNew} />
                </div>
                <div>
                  <FieldLabel htmlFor="agent-desc" hint="Shown in the agent picker">
                    Description
                  </FieldLabel>
                  <Input id="agent-desc" value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="What this agent is for" maxLength={120} />
                </div>
                <div>
                  <FieldLabel htmlFor="agent-instructions" hint="Optional">
                    Instructions
                  </FieldLabel>
                  <Input.TextArea
                    id="agent-instructions"
                    value={draft.instructions}
                    onChange={(e) => set({ instructions: e.target.value })}
                    autoSize={{ minRows: 6, maxRows: 16 }}
                    placeholder={'Brief it like a colleague: who it helps, what to focus on, what to avoid.\n\nExample: “Always compare at least three products and show prices in a table.”'}
                  />
                </div>
              </div>
            ),
          },
          {
            key: 'model',
            label: 'Model',
            children: (
              <div className="form-stack">
                {!providers.length && <div className="inline-note warning">No model is connected yet. Add one in Models first.</div>}
                <div>
                  <FieldLabel>Connection</FieldLabel>
                  <Select
                    style={{ width: '100%' }}
                    value={draft.providerId ?? '__default'}
                    onChange={(v) => {
                      set({ providerId: v === '__default' ? null : v });
                      setModels([]);
                    }}
                    options={[
                      { value: '__default', label: `Default${providers.length ? ` — ${(providers.find((p) => p.id === settings.defaultProviderId) ?? providers[0])?.name}` : ''}` },
                      ...providers.map((p) => ({ value: p.id, label: p.name })),
                    ]}
                  />
                </div>
                <div>
                  <FieldLabel hint={provider ? `Leave empty to use ${provider.defaultModel || 'the connection default'}` : undefined}>Model</FieldLabel>
                  <div className="row-gap">
                    <AutoComplete
                      style={{ flex: 1 }}
                      value={draft.model}
                      onChange={(v) => set({ model: v })}
                      options={[...new Set([...(provider ? presetById(provider.preset).models?.map((m) => m.id) ?? [] : []), ...models])].map((m) => ({
                        value: m,
                        label: knownModel(m) ? `${knownModel(m)!.label} — ${m}` : m,
                      }))}
                      filterOption={(input, option) => (option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
                      placeholder={provider?.defaultModel || 'Model name'}
                      allowClear
                    />
                    <Tooltip title="Load available models">
                      <Button icon={<RefreshCw size={14} className={loadingModels ? 'spin' : ''} />} onClick={() => void loadModels()} disabled={!provider} aria-label="Load available models" />
                    </Tooltip>
                  </div>
                  {modelError && <div className="field-error">{modelError}</div>}
                  {models.length > 0 && <div className="field-help">{models.length} models available — start typing to filter.</div>}
                  {knownModel(draft.model || provider?.defaultModel || '')?.tools === false && (
                    <div className="inline-note warning" style={{ marginTop: 8 }}>
                      {knownModel(draft.model || provider?.defaultModel || '')!.label} can’t use tools: this agent will read the page and answer, but can’t click, type or navigate.
                    </div>
                  )}
                </div>
                <div>
                  <FieldLabel hint={draft.temperature.toFixed(1)}>Creativity</FieldLabel>
                  <Slider min={0} max={1} step={0.1} value={draft.temperature} onChange={(v) => set({ temperature: v })} marks={{ 0: 'Precise', 1: 'Creative' }} tooltip={{ open: false }} />
                  <div className="field-help">Low values make browsing more reliable.</div>
                </div>
                <div className="setting-row bare">
                  <div className="setting-text">
                    <div className="setting-label">Double-check before answering</div>
                    <div className="setting-desc">When the agent says it selected, saved or added something, it first re-reads the page to confirm it. Catches made-up results; costs one more model call.</div>
                  </div>
                  <Switch checked={draft.verify !== false} onChange={(v) => set({ verify: v })} aria-label="Double-check before answering" />
                </div>
                <div>
                  <FieldLabel hint="Per task">Step limit</FieldLabel>
                  <InputNumber min={3} max={100} value={draft.maxSteps} onChange={(v) => set({ maxSteps: v ?? 25 })} style={{ width: 120 }} />
                  <div className="field-help">The agent stops and explains if a task needs more steps than this.</div>
                </div>
              </div>
            ),
          },
          {
            key: 'tools',
            label: `Tools · ${toolCount}`,
            children: (
              <div className="form-stack">
                {categories.map((cat) => {
                  const tools = BUILT_IN_TOOLS.filter((t) => t.category === cat);
                  const allOn = tools.every((t) => draft.toolIds.includes(t.id));
                  return (
                    <div key={cat} className="tool-group">
                      <div className="tool-group-head">
                        <div>
                          <div className="tool-group-title">{TOOL_CATEGORIES[cat].label}</div>
                          <div className="tool-group-desc">{TOOL_CATEGORIES[cat].description}</div>
                        </div>
                        <button
                          type="button"
                          className="link-btn small"
                          onClick={() => set({ toolIds: allOn ? draft.toolIds.filter((id) => !tools.some((t) => t.id === id)) : [...new Set([...draft.toolIds, ...tools.map((t) => t.id)])] })}
                        >
                          {allOn ? 'Turn all off' : 'Turn all on'}
                        </button>
                      </div>
                      {tools.map((t) => {
                        const off = settings.disabledToolIds.includes(t.id);
                        return (
                          <label key={t.id} className={`check-row ${off ? 'is-off' : ''}`}>
                            <Checkbox checked={draft.toolIds.includes(t.id)} onChange={(e) => toggleTool(t.id, e.target.checked)} />
                            <span className="check-icon">
                              <NamedIcon name={t.icon} size={15} />
                            </span>
                            <span className="check-text">
                              <span className="check-title">{t.label}</span>
                              <span className="check-desc">{t.description}</span>
                            </span>
                            {off ? <span className="pill">Off everywhere</span> : <span className={`pill ${RISK_PILL[t.risk].cls}`}>{RISK_PILL[t.risk].label}</span>}
                          </label>
                        );
                      })}
                    </div>
                  );
                })}
                <div className="tool-group">
                  <div className="tool-group-head">
                    <div>
                      <div className="tool-group-title">Custom tools</div>
                      <div className="tool-group-desc">Your own HTTP tools, created in Tools</div>
                    </div>
                  </div>
                  {customTools.length === 0 && <div className="muted small pad">No custom tools yet.</div>}
                  {customTools.map((t) => {
                    const key = `${CUSTOM_PREFIX}${t.id}`;
                    return (
                      <label key={t.id} className="check-row">
                        <Checkbox checked={draft.toolIds.includes(key)} onChange={(e) => toggleTool(key, e.target.checked)} />
                        <span className="check-icon">
                          <NamedIcon name="Webhook" size={15} />
                        </span>
                        <span className="check-text">
                          <span className="check-title">{t.label || t.name}</span>
                          <span className="check-desc">{t.description}</span>
                        </span>
                        {t.needsApproval && <span className="pill warning">Asks first</span>}
                      </label>
                    );
                  })}
                </div>
              </div>
            ),
          },
          {
            key: 'skills',
            label: `Skills · ${draft.skillIds.filter((id) => skills.some((s) => s.id === id)).length}`,
            children: (
              <div className="form-stack">
                <p className="muted small" style={{ margin: 0 }}>
                  Skills are reusable know-how. “Always on” skills are part of every task; “When relevant” skills are loaded by the agent when it needs them.
                </p>
                {skills.length === 0 && <div className="muted small">No skills yet — create them in Skills.</div>}
                {skills.map((s) => (
                  <label key={s.id} className="check-row">
                    <Checkbox checked={draft.skillIds.includes(s.id)} onChange={(e) => toggleSkill(s.id, e.target.checked)} />
                    <span className="check-icon">
                      <NamedIcon name="Sparkles" size={15} />
                    </span>
                    <span className="check-text">
                      <span className="check-title">{s.name}</span>
                      <span className="check-desc">{s.description}</span>
                    </span>
                    <span className={`pill ${s.activation === 'always' ? 'success' : ''}`}>{s.activation === 'always' ? 'Always on' : 'When relevant'}</span>
                  </label>
                ))}
              </div>
            ),
          },
          {
            key: 'team',
            label: draft.team?.memberIds.length ? `Team · ${draft.team.memberIds.length}` : 'Team',
            children: (() => {
              const team = draft.team ?? { memberIds: [], parallel: true, maxParallel: 3, tidyUp: true };
              const setTeam = (patch: Partial<typeof team>) => set({ team: { ...team, ...patch } });
              const candidates = agents.filter((a) => a.id !== draft.id && !a.team?.memberIds.length);
              const leads = team.memberIds.length > 0;
              return (
                <div className="form-stack">
                  <p className="muted small" style={{ margin: 0 }}>
                    A team agent doesn’t do the work itself: it splits your request into one task per member — for example medications to the Medication agent, diagnoses to the Diagnosis agent — and the members do their parts.
                  </p>
                  <div>
                    <FieldLabel hint={leads ? `${team.memberIds.length} selected` : 'None — works alone'}>Team members</FieldLabel>
                    <div className="check-list">
                      {candidates.length === 0 && <div className="muted small pad">Create the member agents first.</div>}
                      {candidates.map((a) => (
                        <label key={a.id} className="check-row compact">
                          <Checkbox
                            checked={team.memberIds.includes(a.id)}
                            onChange={(e) => setTeam({ memberIds: e.target.checked ? [...team.memberIds, a.id] : team.memberIds.filter((x) => x !== a.id) })}
                          />
                          <AgentAvatar avatar={a.avatar} size={22} />
                          <span className="check-text">
                            <span className="check-title">{a.name}</span>
                            {a.description && <span className="check-desc">{a.description}</span>}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                  {leads && (
                    <>
                      <div className="setting-row bare">
                        <div className="setting-text">
                          <div className="setting-label">Run members at the same time</div>
                          <div className="setting-desc">Each member works in its own tab. Their thinking overlaps; clicks and typing take quick turns in front. Off: one after another in your tab.</div>
                        </div>
                        <Switch checked={team.parallel} onChange={(v) => setTeam({ parallel: v })} aria-label="Run members at the same time" />
                      </div>
                      {team.parallel && (
                        <>
                          <div>
                            <FieldLabel hint="Members at once">Parallel limit</FieldLabel>
                            <InputNumber min={1} max={8} value={team.maxParallel} onChange={(v) => setTeam({ maxParallel: v ?? 3 })} style={{ width: 120 }} />
                            <div className="field-help">Match your model server: the Kaggle notebook answers 5 requests at once on GPU T4 ×2, 2 on a single T4. Local Ollama: usually 1–2.</div>
                          </div>
                          <div className="setting-row bare">
                            <div className="setting-text">
                              <div className="setting-label">Tidy up when done</div>
                              <div className="setting-desc">Close the members’ finished tabs and reload your page so it shows their changes. Tabs of members that failed stay open.</div>
                            </div>
                            <Switch checked={team.tidyUp} onChange={(v) => setTeam({ tidyUp: v })} aria-label="Tidy up when done" />
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              );
            })(),
          },
          {
            key: 'safety',
            label: 'Approvals',
            children: (
              <div className="form-stack">
                <div className="radio-cards" role="radiogroup" aria-label="When to ask for approval">
                  {POLICIES.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      role="radio"
                      aria-checked={draft.confirmation === p.value}
                      className={`radio-card ${draft.confirmation === p.value ? 'on' : ''} ${p.value === 'never' ? 'caution' : ''}`}
                      onClick={() => set({ confirmation: p.value })}
                    >
                      <span className="radio-dot" aria-hidden />
                      <span>
                        <span className="radio-title">{p.title}</span>
                        <span className="radio-text">{p.text}</span>
                      </span>
                    </button>
                  ))}
                </div>
                <div className="field-help">Site rules in Permissions (blocked and read-only sites) always apply, whatever you choose here.</div>
              </div>
            ),
          },
        ]}
      />
    </Drawer>
  );
}
