import { Button, Checkbox, Collapse, Drawer, Input, Switch } from 'antd';
import { RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { BROWSER_TOOLS } from '@/agent/tools/browserTools';
import { applyOverride, specOf } from '@/agent/tools/registry';
import type { ToolMeta } from '@/shared/constants/tools';
import type { ToolOverride } from '@/shared/types/config';
import { useAppDispatch, useAppSelector } from '@/store';
import { configActions } from '@/store/configSlice';
import { AgentAvatar } from '../../components/Brand';
import { NamedIcon } from '../../components/icons';
import { FieldLabel } from './parts';

interface ParamInfo {
  name: string;
  type: string;
  required: boolean;
  description: string;
  options?: string[];
}

type JsonSchema = { properties?: Record<string, { type?: string; description?: string; enum?: string[] }>; required?: string[] };

function paramsOf(parameters: Record<string, unknown>): ParamInfo[] {
  const schema = parameters as JsonSchema;
  return Object.entries(schema.properties ?? {}).map(([name, p]) => ({
    name,
    type: p.enum ? 'choice' : (p.type ?? 'any'),
    required: (schema.required ?? []).includes(name),
    description: p.description ?? '',
    options: p.enum,
  }));
}

const WHEN_IT_ASKS: Record<ToolMeta['risk'], string> = {
  read: 'Never asks — it only looks at the page or moves around it.',
  action: 'Asks only when the agent’s approvals are set to “Always ask”.',
  sensitive: 'With “Smart” approvals it asks before anything that buys, pays, sends, deletes, submits a form or changes account settings.',
};

/** View everything the model is told about a built-in tool, and change it. */
export function BuiltInToolEditor({ meta, onClose }: { meta: ToolMeta | null; onClose: () => void }) {
  const dispatch = useAppDispatch();
  const { agents, settings } = useAppSelector((s) => s.config.config);
  const tool = useMemo(() => BROWSER_TOOLS.find((t) => t.name === meta?.id) ?? null, [meta]);
  const saved = (meta && settings.toolOverrides?.[meta.id]) || undefined;
  const [draft, setDraft] = useState<ToolOverride>({});

  useEffect(() => {
    if (meta) setDraft(structuredClone(settings.toolOverrides?.[meta.id] ?? {}));
    // Only when a different tool is opened.
  }, [meta]);

  if (!meta || !tool) return <Drawer open={false} />;
  const defaults = specOf(tool);
  const params = paramsOf(defaults.parameters);
  const preview = specOf(applyOverride(tool, draft));
  const users = agents.filter((a) => a.toolIds.includes(meta.id));
  const enabled = !settings.disabledToolIds.includes(meta.id);
  const edited = !!(draft.description?.trim() || draft.alwaysAsk || Object.values(draft.params ?? {}).some((v) => v.trim()));

  const setParam = (name: string, value: string) => setDraft((d) => ({ ...d, params: { ...d.params, [name]: value } }));

  const save = (next: ToolOverride | null) => {
    const all = { ...(settings.toolOverrides ?? {}) };
    const clean: ToolOverride = {};
    if (next?.description?.trim() && next.description.trim() !== tool.description) clean.description = next.description.trim();
    const p = Object.fromEntries(
      Object.entries(next?.params ?? {})
        .map(([k, v]) => [k, v.trim()] as const)
        .filter(([k, v]) => v && v !== params.find((x) => x.name === k)?.description),
    );
    if (Object.keys(p).length) clean.params = p;
    if (next?.alwaysAsk) clean.alwaysAsk = true;
    if (Object.keys(clean).length) all[meta.id] = clean;
    else delete all[meta.id];
    dispatch(configActions.updateSettings({ toolOverrides: all }));
    onClose();
  };

  return (
    <Drawer
      open
      onClose={onClose}
      width={640}
      title={
        <span className="tool-drawer-title">
          <span className="list-icon">
            <NamedIcon name={meta.icon} size={16} />
          </span>
          {meta.label}
          <span className="mono muted small">{meta.id}</span>
        </span>
      }
      footer={
        <div className="drawer-foot">
          {(saved || edited) && (
            <Button type="text" icon={<RotateCcw size={14} />} onClick={() => setDraft({})}>
              Reset to default
            </Button>
          )}
          <span className="spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" onClick={() => save(draft)}>
            Save changes
          </Button>
        </div>
      }
    >
      <div className="form-stack">
        <p className="tool-drawer-lede">{meta.description}</p>

        <div>
          <FieldLabel htmlFor="tool-model-desc" hint="The agent decides when and how to use the tool from this">
            What the agent is told
          </FieldLabel>
          <Input.TextArea
            id="tool-model-desc"
            value={draft.description ?? tool.description}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            autoSize={{ minRows: 3, maxRows: 10 }}
          />
          <div className="field-help">
            Add your own rules here — for example “On our PMS, open a patient by clicking the name, never an icon.” Applies to every agent with this tool.
          </div>
        </div>

        <div>
          <FieldLabel hint={params.length ? 'What the agent fills in when it uses the tool' : undefined}>Inputs</FieldLabel>
          {params.length === 0 ? (
            <div className="field-help">This tool takes no inputs.</div>
          ) : (
            <div className="tool-params">
              {params.map((p) => (
                <div key={p.name} className="tool-param">
                  <div className="tool-param-head">
                    <span className="mono">{p.name}</span>
                    <span className="pill">{p.type}</span>
                    {p.required ? <span className="pill">required</span> : <span className="muted small">optional</span>}
                  </div>
                  {p.options && <div className="muted small">One of: {p.options.join(', ')}</div>}
                  <Input
                    value={draft.params?.[p.name] ?? p.description}
                    onChange={(e) => setParam(p.name, e.target.value)}
                    aria-label={`What the agent is told about ${p.name}`}
                    placeholder={p.description || 'Describe this input'}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <FieldLabel>Approval</FieldLabel>
          <div className="field-help tool-asks">{WHEN_IT_ASKS[meta.risk]}</div>
          <div className="setting-row bare">
            <div className="setting-text">
              <div className="setting-label">Always ask before using it</div>
              <div className="setting-desc">Every use waits for your OK, whatever the agent’s approval setting.</div>
            </div>
            <Switch checked={!!draft.alwaysAsk} onChange={(v) => setDraft((d) => ({ ...d, alwaysAsk: v }))} aria-label="Always ask before using it" />
          </div>
        </div>

        <div>
          <FieldLabel hint={enabled ? undefined : 'Switched off for all agents'}>Agents with this tool</FieldLabel>
          <div className="check-list">
            {agents.map((a) => (
              <label key={a.id} className="check-row compact">
                <Checkbox checked={a.toolIds.includes(meta.id)} onChange={(e) => dispatch(configActions.toggleToolForAgent({ agentId: a.id, toolId: meta.id, on: e.target.checked }))} />
                <AgentAvatar avatar={a.avatar} size={22} />
                <span className="check-title">{a.name}</span>
              </label>
            ))}
          </div>
          {users.length === 0 && <div className="field-help">No agent uses this tool yet.</div>}
        </div>

        <Collapse
          size="small"
          items={[
            {
              key: 'spec',
              label: 'Exactly what the model receives',
              children: <pre className="spec-json mono">{JSON.stringify(preview, null, 2)}</pre>,
            },
          ]}
        />
      </div>
    </Drawer>
  );
}
