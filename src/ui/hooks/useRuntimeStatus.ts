import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/agent/llm';
import { describeCredit, fetchCredit, hasCredit, LOW_CREDIT, type Credit } from '@/agent/llm/credit';
import { resolveProvider } from '@/agent/runtime/agentRun';
import { locationOf, modelLabel, type Location } from '@/shared/constants/providers';
import type { AgentConfig, AppConfig, ProviderConfig } from '@/shared/types/config';
import { toAgentError } from '@/shared/utils/errors';
import { SPEECH_ENGINES, speechBase, speechHealth, voiceReady } from '@/shared/voice/speech';

export interface Health {
  state: 'checking' | 'ok' | 'warning' | 'error';
  message: string;
}

export interface RuntimePart {
  name: string;
  id: string;
  location: { kind: Location; label: string; host: string };
  connection: string;
  health: Health;
  /** What the connection's key can still spend (OpenRouter). */
  credit?: Credit;
}

const REFRESH_MS = 120_000;
const CHECKING: Health = { state: 'checking', message: 'Checking…' };

async function checkActions(provider: ProviderConfig, model: string, signal: AbortSignal): Promise<Health & { credit?: Credit }> {
  try {
    if (hasCredit(provider) && provider.apiKey) {
      // OpenRouter: the key answers with what it can still spend — that is also the connection check.
      const credit = await fetchCredit(provider, signal);
      const text = describeCredit(credit);
      if (credit.left === 0) return { state: 'error', message: `No credit left (${text}). Add credit or raise the key's limit on openrouter.ai.`, credit };
      if (credit.left != null && credit.left < LOW_CREDIT) return { state: 'warning', message: `Credit running out: ${text}`, credit };
      return { state: 'ok', message: `Connected · ${text}`, credit };
    }
    if (provider.preset === 'kaggle') {
      // The notebook's /health says which GPU and which models it has.
      const h = await speechHealth({ serverUrl: provider.baseUrl, key: provider.apiKey }, signal);
      const gpu = h.gpu ? h.gpu.split(',')[0] : 'GPU';
      if (h.models.length && !h.models.includes(model)) {
        return { state: 'warning', message: `Connected (${gpu}), but ${modelLabel(model)} isn’t loaded on the notebook${/bonsai/i.test(model) ? ' — Bonsai needs GPU T4 ×2' : ''}.` };
      }
      return { state: 'ok', message: `Connected · ${gpu}${h.loaded.includes(model) ? ' · model in memory' : ''}` };
    }
    const models = await createClient(provider).listModels(signal);
    if (provider.kind === 'ollama' && models.length && !models.includes(model)) {
      return { state: 'warning', message: `Ollama is running, but ${model} isn’t installed. Run: ollama pull ${model}` };
    }
    return { state: 'ok', message: 'Connected' };
  } catch (err) {
    const e = toAgentError(err);
    return { state: 'error', message: e.code === 'cancelled' ? 'Check cancelled' : e.userMessage };
  }
}

/**
 * What powers the side panel right now — the active agent's model and the voice engine —
 * where each runs, and whether it answers. Re-checked on change, on focus and every 2 minutes.
 */
export function useRuntimeStatus(agent: AgentConfig, config: AppConfig, url = '', running = false) {
  const voice = config.settings.voice;
  const resolved = useMemo(() => {
    try {
      return resolveProvider(agent, config, url);
    } catch {
      return null;
    }
  }, [agent, config, url]);

  const [actionsHealth, setActionsHealth] = useState<Health & { credit?: Credit }>(CHECKING);
  const [voiceHealth, setVoiceHealth] = useState<Health>(CHECKING);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);

  const provider = resolved?.provider;
  const model = resolved?.model ?? '';
  const voiceOn = voiceReady(voice);
  const key = [provider?.id, provider?.baseUrl, provider?.apiKey, provider?.kind, model, voiceOn, voice.serverUrl, voice.key, voice.engine].join('|');

  const refresh = useCallback(async () => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    if (provider) setActionsHealth(CHECKING);
    if (voiceOn) setVoiceHealth(CHECKING);
    const actions = provider ? checkActions(provider, model, ctrl.signal) : Promise.resolve(null);
    const speech = voiceOn && voice.engine === 'browser'
      ? Promise.resolve<Health>({ state: 'ok', message: 'Built into Chrome — no server needed' })
      : voiceOn
      ? speechHealth(voice, ctrl.signal)
          .then((h): Health => {
            const engine = SPEECH_ENGINES.find((e) => e.id === voice.engine)!;
            if (!h.engines.some((e) => e.id === voice.engine)) return { state: 'warning', message: `Connected, but ${engine.label} isn’t loaded on the server.` };
            const device = h.engines.find((e) => e.id === voice.engine)?.device;
            return { state: 'ok', message: `Connected${device ? ` · on ${device === 'cuda' ? 'GPU' : device.toUpperCase()}` : ''}` };
          })
          .catch((err): Health => ({ state: 'error', message: toAgentError(err).userMessage }))
      : Promise.resolve(null);
    const [a, v] = await Promise.all([actions, speech]);
    if (ctrl.signal.aborted) return;
    if (a) setActionsHealth(a);
    if (v) setVoiceHealth(v);
    setCheckedAt(Date.now());
    // `key` captures every input that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // A task that just finished has spent some of the credit: look again.
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running && provider && hasCredit(provider)) void refresh();
    wasRunning.current = running;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      abort.current?.abort();
    };
  }, [refresh]);

  // The decision model on: it picks the model per task, so the bar names it, not the agent's own model.
  const picker = agent.decisionModel?.trim() && provider && /openrouter\.ai/.test(provider.baseUrl) ? agent.decisionModel.trim() : null;
  const actions: RuntimePart | null = provider
    ? { name: picker ? `${modelLabel(picker)} picks` : modelLabel(model), id: picker ? `${picker} picks the model per task from your list` : model, location: locationOf(provider.baseUrl, provider.preset), connection: provider.name, health: actionsHealth, credit: actionsHealth.credit }
    : null;
  const engine = SPEECH_ENGINES.find((e) => e.id === voice.engine)!;
  const speech: RuntimePart | null = voiceOn
    ? { name: engine.short, id: engine.label, location: voice.engine === 'browser' ? { kind: 'cloud', label: 'Google, through Chrome', host: '' } : locationOf(speechBase(voice.serverUrl), config.providers.some((p) => p.preset === 'kaggle' && speechBase(p.baseUrl) === speechBase(voice.serverUrl)) ? 'kaggle' : undefined), connection: 'Voice', health: voiceHealth }
    : null;

  return { actions, voice: speech, checkedAt, refresh };
}
