import { App, AutoComplete, Button, Dropdown, Input, InputNumber, Modal, Segmented, Switch, Tooltip } from 'antd';
import { DEFAULT_CONTEXT_WINDOW } from '@/agent/llm/ollama';
import { CheckCircle2, ExternalLink, Laptop, MoreHorizontal, Plus, RefreshCw, Star, Trash2, XCircle, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createClient } from '@/agent/llm';
import { describeCredit, fetchCredit, hasCredit } from '@/agent/llm/credit';
import { KAGGLE_CONTEXT_WINDOW, PROVIDER_PRESETS, presetById, withApiPath, type ProviderPreset } from '@/shared/constants/providers';
import { speechBase } from '@/shared/voice/speech';
import type { ProviderConfig, ThinkingLevel } from '@/shared/types/config';
import { thinkingOf, uid } from '@/shared/utils';
import { AgentError, toAgentError } from '@/shared/utils/errors';
import { useAppDispatch, useAppSelector } from '@/store';
import { configActions } from '@/store/configSlice';
import { FieldLabel, PageHeader, Section } from './parts';
import { FitList } from './layout';

type TestState = { status: 'idle' | 'testing' | 'ok' | 'error'; message?: string };

/** A tiny tool-calling round trip — proves the address, key, model and tool support at once. */
async function testConnection(provider: ProviderConfig, model: string): Promise<string> {
  // OpenRouter: what the key can still spend — checked first, so an empty key says why it fails.
  const credit = hasCredit(provider) && provider.apiKey ? await fetchCredit(provider).then((c) => ` Credit: ${describeCredit(c)}.`, () => '') : '';
  if (/^ Credit: \$0\.00 left/.test(credit)) throw new AgentError('model_error', `No credit left on this key.${credit} Add credit or raise the key's limit on openrouter.ai.`);
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
  if (res.toolCalls.some((c) => c.name === 'ping')) return `Connected — the model can use tools.${credit}`;
  return `Connected, but the model answered without using a tool. Agents work best with models that support tool calling.${credit}`;
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
  const voice = settings.voice;
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
        ...(preset.thinking ? { thinking: preset.thinking } : {}),
        ...(preset.keyHeader ? { keyHeader: preset.keyHeader } : {}),
        ...(preset.timeoutMs ? { timeoutMs: preset.timeoutMs } : {}),
        ...(preset.kind === 'ollama' ? { contextWindow: DEFAULT_CONTEXT_WINDOW } : preset.id === 'kaggle' ? { contextWindow: KAGGLE_CONTEXT_WINDOW } : {}),
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
        <FitList className="list-card" label="Connections" estimate={70}>
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
        </FitList>
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
          // The Kaggle notebook also serves speech: set voice up from the same address and key.
          if (p.preset === 'kaggle' && (!voice.serverUrl.trim() || speechBase(voice.serverUrl) === speechBase(p.baseUrl))) {
            dispatch(configActions.updateSettings({ voice: { ...voice, serverUrl: speechBase(p.baseUrl), key: p.apiKey, enabled: voice.enabled || !voice.serverUrl.trim() } }));
          }
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
          <Button type="primary" disabled={!valid} onClick={() => onSave({ ...draft, name: draft.name.trim(), baseUrl: withApiPath(draft.baseUrl, preset.apiPath), defaultModel: draft.defaultModel.trim() })}>
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
          <Input
            id="prov-url"
            className="mono"
            value={draft.baseUrl}
            onChange={(e) => set({ baseUrl: e.target.value })}
            onBlur={() => preset.apiPath && set({ baseUrl: withApiPath(draft.baseUrl, preset.apiPath) })}
            placeholder={preset.id === 'kaggle' ? 'https://xxxx.trycloudflare.com' : preset.baseUrl || 'http://localhost:8000/v1'}
            status={draft.baseUrl && !urlOk ? 'error' : undefined}
          />
          {preset.apiPath && <div className="field-help">Paste the address the notebook prints — {preset.apiPath} is added for you. It changes every time the notebook restarts.</div>}
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
                ) : preset.needsKey ? undefined : (
                  'Optional'
                )
              }
            >
              {preset.keyLabel ?? 'API key'}
            </FieldLabel>
            <Input.Password id="prov-key" value={draft.apiKey} onChange={(e) => set({ apiKey: e.target.value })} placeholder={preset.keyHeader ? 'The KEY printed by the notebook' : 'Paste your key'} autoComplete="off" />
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
          {preset.models ? (
            <div className="model-options" role="radiogroup" aria-label="Models on this server">
              {preset.models.map((m) => (
                <button key={m.id} type="button" role="radio" aria-checked={draft.defaultModel === m.id} className={`model-option ${draft.defaultModel === m.id ? 'on' : ''}`} onClick={() => set({ defaultModel: m.id })}>
                  <span className="model-option-head">
                    <span className="model-option-name">{m.label}</span>
                    <span className={`pill ${m.tools ? 'success' : 'warning'}`}>{m.tools ? 'Can act' : 'Answers only'}</span>
                  </span>
                  <span className="model-option-note">{m.note}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="field-help">Choose a model that supports tool calling.</div>
          )}
        </div>
        {draft.kind !== 'anthropic' && (
          <div className="setting-row bare">
            <div className="setting-text">
              <div className="setting-label">Context window</div>
              <div className="setting-desc">
                {draft.kind === 'ollama'
                  ? 'How much the model can read at once, in tokens. Web pages need room — 12k or more works well. Larger uses more memory.'
                  : draft.preset === 'kaggle'
                    ? 'The notebook prints its context window (CTX): 16,384 for most, 65,536 for the web_agent_qwen38long notebook. Set the same number here.'
                    : 'How much the server lets the model read, in tokens. Long tasks are trimmed to fit. Leave empty if you don’t know.'}
              </div>
            </div>
            <InputNumber
              min={2048}
              max={1_000_000}
              step={1024}
              value={draft.contextWindow ?? (draft.kind === 'ollama' ? DEFAULT_CONTEXT_WINDOW : draft.preset === 'kaggle' ? KAGGLE_CONTEXT_WINDOW : null)}
              placeholder="Unknown"
              onChange={(v) => set({ contextWindow: v ?? undefined })}
              style={{ width: 120 }}
              aria-label="Context window"
            />
          </div>
        )}
        {draft.kind === 'openai' && (
          <div className="setting-row bare">
            <div className="setting-text">
              <div className="setting-label">Headroom</div>
              <div className="setting-desc">
                Compresses each call's messages before they go to the model, with Headroom (github.com/headroomlabs-ai/headroom). It saves
                a few percent of the tokens, and it can drop words from the site's instructions — off unless you want to try it.
              </div>
            </div>
            <Switch checked={!!draft.headroomOn} onChange={(on) => set({ headroomOn: on || undefined })} aria-label="Headroom" />
          </div>
        )}
        {draft.kind === 'openai' && draft.headroomOn && (
          <div className="setting-row bare stacked">
            <div className="setting-text">
              <label className="setting-label" htmlFor="prov-headroom">
                Headroom proxy
              </label>
              <div className="setting-desc">
                Its address — http://localhost:8787 when it runs on this computer, or this notebook's address followed by /headroom on
                Kaggle. When it can't be reached, the messages go as they are.
              </div>
            </div>
            <Input
              id="prov-headroom"
              value={draft.headroomUrl ?? ''}
              onChange={(e) => set({ headroomUrl: e.target.value.trim() || undefined })}
              placeholder="http://localhost:8787"
              autoComplete="off"
            />
            {draft.headroomUrl && (
              <Input.Password
                value={draft.headroomToken ?? ''}
                onChange={(e) => set({ headroomToken: e.target.value.trim() || undefined })}
                placeholder="Proxy token (only if the proxy asks for one)"
                autoComplete="off"
                aria-label="Headroom proxy token"
                style={{ marginTop: 6 }}
              />
            )}
          </div>
        )}
        <div className="setting-row bare stacked">
          <div className="setting-text">
            <div className="setting-label">Thinking</div>
            <div className="setting-desc">
              How much a reasoning model (Gemini, Claude, Qwen 3, DeepSeek…) thinks before each step. Off and Low are much faster; High is for hard pages. Model default leaves it to the model.
            </div>
          </div>
          <Segmented
            size="small"
            value={thinkingOf(draft) ?? 'default'}
            onChange={(v) => set({ thinking: v === 'default' ? undefined : (v as ThinkingLevel), skipThinking: undefined })}
            options={[
              { label: 'Model default', value: 'default' },
              { label: 'Off', value: 'off' },
              { label: 'Low', value: 'low' },
              { label: 'High', value: 'high' },
            ]}
            aria-label="Thinking"
          />
        </div>
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

