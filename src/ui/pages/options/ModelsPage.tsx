import { App, AutoComplete, Button, Dropdown, Input, InputNumber, Modal, Switch, Tooltip } from 'antd';
import { DEFAULT_CONTEXT_WINDOW } from '@/agent/llm/ollama';
import { CheckCircle2, ExternalLink, Laptop, MoreHorizontal, Plus, RefreshCw, Star, Trash2, XCircle, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createClient } from '@/agent/llm';
import { PROVIDER_PRESETS, presetById, type ProviderPreset } from '@/shared/constants/providers';
import type { ProviderConfig } from '@/shared/types/config';
import { uid } from '@/shared/utils';
import { toAgentError } from '@/shared/utils/errors';
import { useAppDispatch, useAppSelector } from '@/store';
import { configActions } from '@/store/configSlice';
import { FieldLabel, PageHeader, Section } from './parts';

type TestState = { status: 'idle' | 'testing' | 'ok' | 'error'; message?: string };

/** A tiny tool-calling round trip — proves the address, key, model and tool support at once. */
async function testConnection(provider: ProviderConfig, model: string): Promise<string> {
  const client = createClient(provider);
  const res = await client.chat({
    model,
    temperature: 0,
    messages: [
      { role: 'system', content: 'You are a connection test. Call the ping tool once.' },
      { role: 'user', content: 'Call ping now.' },
    ],
    tools: [{ name: 'ping', description: 'Confirms the connection works.', parameters: { type: 'object', properties: {}, additionalProperties: false } }],
  });
  if (res.toolCalls.some((c) => c.name === 'ping')) return 'Connected — the model can use tools.';
  return 'Connected, but the model answered without using a tool. Agents work best with models that support tool calling.';
}

function PresetBadge({ preset, size = 36 }: { preset: ProviderPreset; size?: number }) {
  return (
    <span className={`preset-badge ${preset.local ? 'local' : ''}`} style={{ width: size, height: size }} aria-hidden>
      {preset.local ? <Laptop size={size * 0.46} /> : <Zap size={size * 0.46} />}
    </span>
  );
}

export function ModelsPage() {
  const { providers, settings, agents } = useAppSelector((s) => s.config.config);
  const dispatch = useAppDispatch();
  const { modal, message } = App.useApp();
  const [editing, setEditing] = useState<{ provider: ProviderConfig; isNew: boolean } | null>(null);
  const [picking, setPicking] = useState(false);
  const [tests, setTests] = useState<Record<string, TestState>>({});

  const startFromPreset = (preset: ProviderPreset) => {
    setPicking(false);
    setEditing({
      isNew: true,
      provider: {
        id: uid('prov_'),
        name: preset.id === 'custom' ? 'My server' : preset.label,
        kind: preset.kind,
        preset: preset.id,
        baseUrl: preset.baseUrl,
        apiKey: '',
        defaultModel: preset.model,
        skipThinking: preset.skipThinking ?? false,
        ...(preset.kind === 'ollama' ? { contextWindow: DEFAULT_CONTEXT_WINDOW } : {}),
        createdAt: Date.now(),
      },
    });
  };

  const runTest = async (p: ProviderConfig) => {
    setTests((t) => ({ ...t, [p.id]: { status: 'testing' } }));
    try {
      const msg = await testConnection(p, p.defaultModel);
      setTests((t) => ({ ...t, [p.id]: { status: 'ok', message: msg } }));
    } catch (err) {
      setTests((t) => ({ ...t, [p.id]: { status: 'error', message: toAgentError(err).userMessage } }));
    }
  };

  const defaultId = settings.defaultProviderId ?? providers[0]?.id;

  return (
    <>
      <PageHeader
        title="Models"
        description="Connect the AI that powers your agents — on this computer or from a provider. Each agent can use a different one."
        actions={
          providers.length > 0 && (
            <Button type="primary" icon={<Plus size={16} />} onClick={() => setPicking(true)}>
              Add connection
            </Button>
          )
        }
      />

      {providers.length === 0 ? (
        <Section>
          <div className="preset-intro">
            <div className="preset-intro-title">Choose where your model runs</div>
            <div className="muted small">You can add more connections later.</div>
          </div>
          <PresetGrid onPick={startFromPreset} />
        </Section>
      ) : (
        <div className="list-card">
          {providers.map((p) => {
            const preset = presetById(p.preset);
            const test = tests[p.id] ?? { status: 'idle' };
            const users = agents.filter((a) => a.providerId === p.id || (!a.providerId && p.id === defaultId)).length;
            return (
              <div key={p.id} className="provider-row">
                <PresetBadge preset={preset} />
                <button type="button" className="provider-main" onClick={() => setEditing({ provider: p, isNew: false })}>
                  <span className="list-title">
                    {p.name} {p.id === defaultId && <span className="pill success">Default</span>}
                  </span>
                  <span className="list-desc">
                    {p.defaultModel || 'No model chosen'} · {safeHost(p.baseUrl)} · used by {users} agent{users === 1 ? '' : 's'}
                  </span>
                  {test.status === 'ok' && (
                    <span className="test-result ok">
                      <CheckCircle2 size={13} /> {test.message}
                    </span>
                  )}
                  {test.status === 'error' && (
                    <span className="test-result error">
                      <XCircle size={13} /> {test.message}
                    </span>
                  )}
                </button>
                <div className="list-side">
                  <Button size="small" loading={test.status === 'testing'} onClick={() => void runTest(p)}>
                    Test
                  </Button>
                  <Dropdown
                    trigger={['click']}
                    menu={{
                      items: [
                        { key: 'default', icon: <Star size={14} />, label: 'Make default', disabled: p.id === defaultId },
                        { type: 'divider' },
                        { key: 'delete', icon: <Trash2 size={14} />, label: 'Delete', danger: true },
                      ],
                      onClick: ({ key }) => {
                        if (key === 'default') dispatch(configActions.updateSettings({ defaultProviderId: p.id }));
                        if (key === 'delete')
                          modal.confirm({
                            title: `Delete “${p.name}”?`,
                            content: 'Agents that use it will switch to the default connection.',
                            okText: 'Delete',
                            okButtonProps: { danger: true },
                            onOk: () => {
                              dispatch(configActions.deleteProvider(p.id));
                            },
                          });
                      },
                    }}
                  >
                    <button type="button" className="icon-btn" aria-label={`More actions for ${p.name}`}>
                      <MoreHorizontal size={16} />
                    </button>
                  </Dropdown>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="footnote">
        API keys are stored only in this browser&apos;s extension storage. Page content goes to a model only while it works on a task you gave it.
      </p>

      <Modal open={picking} onCancel={() => setPicking(false)} footer={null} title="Add a connection" width={640}>
        <PresetGrid onPick={startFromPreset} />
      </Modal>

      <ProviderEditor
        value={editing}
        onClose={() => setEditing(null)}
        onSave={(p) => {
          dispatch(configActions.upsertProvider(p));
          message.success(editing?.isNew ? 'Connection added' : 'Changes saved');
          setEditing(null);
        }}
      />
    </>
  );
}

function PresetGrid({ onPick }: { onPick: (p: ProviderPreset) => void }) {
  return (
    <div className="preset-grid">
      {PROVIDER_PRESETS.map((p) => (
        <button key={p.id} type="button" className="preset-card" onClick={() => onPick(p)}>
          <PresetBadge preset={p} size={32} />
          <span className="preset-text">
            <span className="preset-name">{p.label}</span>
            <span className="preset-kind">{p.local ? 'On this computer' : p.id === 'custom' ? 'Any compatible server' : 'Cloud · API key'}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url || 'no address';
  }
}

function ProviderEditor({ value, onClose, onSave }: { value: { provider: ProviderConfig; isNew: boolean } | null; onClose: () => void; onSave: (p: ProviderConfig) => void }) {
  const [draft, setDraft] = useState<ProviderConfig | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [test, setTest] = useState<TestState>({ status: 'idle' });

  useEffect(() => {
    setDraft(value ? structuredClone(value.provider) : null);
    setModels([]);
    setTest({ status: 'idle' });
  }, [value]);

  if (!draft || !value) return null;
  const preset = presetById(draft.preset);
  const set = (patch: Partial<ProviderConfig>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setTest({ status: 'idle' });
  };

  const load = async () => {
    setLoading(true);
    try {
      const list = await createClient(draft).listModels();
      setModels(list);
      if (!list.length) setTest({ status: 'error', message: 'Connected, but the server listed no models.' });
    } catch (err) {
      setTest({ status: 'error', message: toAgentError(err).userMessage });
    } finally {
      setLoading(false);
    }
  };

  const runTest = async () => {
    setTest({ status: 'testing' });
    try {
      setTest({ status: 'ok', message: await testConnection(draft, draft.defaultModel) });
    } catch (err) {
      setTest({ status: 'error', message: toAgentError(err).userMessage });
    }
  };

  let urlOk = false;
  try {
    urlOk = /^https?:$/.test(new URL(draft.baseUrl).protocol);
  } catch {
    urlOk = false;
  }
  const valid = draft.name.trim() && urlOk && draft.defaultModel.trim() && (!preset.needsKey || draft.apiKey.trim());

  return (
    <Modal
      open
      onCancel={onClose}
      width={560}
      title={
        <div className="drawer-title">
          <PresetBadge preset={preset} size={28} />
          <span>{value.isNew ? `Connect ${preset.label}` : draft.name}</span>
        </div>
      }
      footer={
        <div className="modal-foot">
          <Button onClick={() => void runTest()} loading={test.status === 'testing'} disabled={!urlOk || !draft.defaultModel.trim()}>
            Test connection
          </Button>
          <span className="spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" disabled={!valid} onClick={() => onSave({ ...draft, name: draft.name.trim(), baseUrl: draft.baseUrl.trim(), defaultModel: draft.defaultModel.trim() })}>
            {value.isNew ? 'Add connection' : 'Save'}
          </Button>
        </div>
      }
    >
      <div className="form-stack">
        <div className="inline-note">{preset.hint}</div>
        <div>
          <FieldLabel htmlFor="prov-name">Name</FieldLabel>
          <Input id="prov-name" value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={40} />
        </div>
        <div>
          <FieldLabel htmlFor="prov-url">Address</FieldLabel>
          <Input id="prov-url" className="mono" value={draft.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder={preset.baseUrl || "http://localhost:8000/v1"} status={draft.baseUrl && !urlOk ? 'error' : undefined} />
        </div>
        {(preset.needsKey || preset.id === 'custom' || draft.apiKey) && (
          <div>
            <FieldLabel
              htmlFor="prov-key"
              hint={
                preset.keyUrl ? (
                  <a href={preset.keyUrl} target="_blank" rel="noreferrer">
                    Get a key <ExternalLink size={11} />
                  </a>
                ) : (
                  'Optional'
                )
              }
            >
              API key
            </FieldLabel>
            <Input.Password id="prov-key" value={draft.apiKey} onChange={(e) => set({ apiKey: e.target.value })} placeholder="Paste your key" autoComplete="off" />
          </div>
        )}
        <div>
          <FieldLabel>Model</FieldLabel>
          <div className="row-gap">
            <AutoComplete
              style={{ flex: 1 }}
              value={draft.defaultModel}
              onChange={(v) => set({ defaultModel: v })}
              options={models.map((m) => ({ value: m }))}
              filterOption={(input, option) => (option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
              placeholder="Model name"
            />
            <Tooltip title="Load the models this server offers">
              <Button icon={<RefreshCw size={14} className={loading ? 'spin' : ''} />} onClick={() => void load()} disabled={!urlOk} aria-label="Load models">
                Load
              </Button>
            </Tooltip>
          </div>
          <div className="field-help">Choose a model that supports tool calling.</div>
        </div>
        {draft.kind === 'ollama' && (
          <div className="setting-row bare">
            <div className="setting-text">
              <div className="setting-label">Context window</div>
              <div className="setting-desc">How much the model can read at once, in tokens. Web pages need room — 12k or more works well. Larger uses more memory.</div>
            </div>
            <InputNumber min={2048} max={262144} step={1024} value={draft.contextWindow ?? DEFAULT_CONTEXT_WINDOW} onChange={(v) => set({ contextWindow: v ?? DEFAULT_CONTEXT_WINDOW })} style={{ width: 120 }} aria-label="Context window" />
          </div>
        )}
        {draft.kind !== 'anthropic' && (
          <div className="setting-row bare">
            <div className="setting-text">
              <div className="setting-label">Skip thinking</div>
              <div className="setting-desc">Asks reasoning models (Qwen 3, DeepSeek…) to answer directly. Often 5× faster on local models. Turn off if the server rejects it.</div>
            </div>
            <Switch checked={!!draft.skipThinking} onChange={(v) => set({ skipThinking: v })} aria-label="Skip thinking" />
          </div>
        )}
        {test.status === 'ok' && (
          <div className="test-banner ok" role="status">
            <CheckCircle2 size={16} /> {test.message}
          </div>
        )}
        {test.status === 'error' && (
          <div className="test-banner error" role="alert">
            <XCircle size={16} /> {test.message}
          </div>
        )}
      </div>
    </Modal>
  );
}

