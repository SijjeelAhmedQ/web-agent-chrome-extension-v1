import type { SpeechEngine, VoiceSettings } from '../types/config';
import { AgentError } from '../utils/errors';

/**
 * Client for the speech server in kaggle/careflow_gpu_server.py:
 *   POST /transcribe?engine=whisper|omi&prompt=…   body: 16 kHz mono 16-bit PCM → { text, unclear, heard, ms }
 *   GET  /health                                    → engines and language models on the server
 * Every request carries `X-CareFlow-Key`.
 */

export const SPEECH_ENGINES: { id: SpeechEngine; label: string; note: string }[] = [
  { id: 'whisper', label: 'Whisper large-v3 turbo', note: 'Best with non-US accents, and uses your vocabulary to spell names right.' },
  { id: 'omi', label: 'Omi Med STT v1', note: 'A speech model trained for medical dictation.' },
];

export const SAMPLE_RATE = 16000;

export interface Transcript {
  text: string;
  /** The server wasn't confident; `heard` is its best guess. */
  unclear: boolean;
  heard?: string;
  ms: number;
}

export interface SpeechHealth {
  engines: { id: string; model: string; device: string }[];
  defaultEngine: string;
  gpu: string | null;
  models: string[];
  loaded: string[];
  bonsai: string;
}

/** The server's root (a pasted model address such as …/vllm/v1 is reduced to its origin). */
export function speechBase(serverUrl: string): string {
  try {
    return new URL(serverUrl.trim()).origin;
  } catch {
    return serverUrl.trim().replace(/\/+$/, '');
  }
}

async function call(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal });
  } catch (err) {
    if (signal?.aborted) throw new AgentError('cancelled', 'Stopped.');
    throw new AgentError('model_unreachable', "Can't reach the speech server. Check that the Kaggle notebook is running and the address is current.", String(err));
  }
  if (res.ok) return res;
  const text = await res.text().catch(() => '');
  let detail = text;
  try {
    detail = (JSON.parse(text) as { detail?: string }).detail ?? text;
  } catch {
    /* plain text */
  }
  if (res.status === 401) throw new AgentError('model_auth', 'The speech server rejected the key. Use the key printed by the notebook.', detail);
  if (res.status === 400 && /No \w+ speech model/i.test(detail)) throw new AgentError('model_not_found', `That speech engine isn't loaded on the server. ${detail}`, detail);
  if (res.status === 530 || res.status === 404) throw new AgentError('model_unreachable', 'The speech server address no longer works — Kaggle tunnels change every time the notebook restarts.', detail);
  throw new AgentError('model_error', `The speech server returned an error (${res.status}).`, detail);
}

export async function transcribe(voice: VoiceSettings, pcm: Int16Array, signal?: AbortSignal): Promise<Transcript> {
  const params = new URLSearchParams({ engine: voice.engine });
  if (voice.engine === 'whisper' && voice.vocabulary.trim()) params.set('prompt', voice.vocabulary.trim().slice(0, 1500));
  const res = await call(
    `${speechBase(voice.serverUrl)}/transcribe?${params}`,
    { method: 'POST', headers: { 'X-CareFlow-Key': voice.key, 'Content-Type': 'application/octet-stream' }, body: pcm.buffer as ArrayBuffer },
    signal,
  );
  const data = (await res.json()) as { text?: string; unclear?: boolean; heard?: string | null; ms?: number };
  return { text: (data.text ?? '').trim(), unclear: !!data.unclear, heard: data.heard ?? undefined, ms: data.ms ?? 0 };
}

export async function speechHealth(voice: Pick<VoiceSettings, 'serverUrl' | 'key'>, signal?: AbortSignal): Promise<SpeechHealth> {
  const res = await call(`${speechBase(voice.serverUrl)}/health`, { headers: { 'X-CareFlow-Key': voice.key } }, signal);
  const data = (await res.json()) as {
    default?: string;
    gpu?: string | null;
    engines?: Record<string, { model: string; device: string }>;
    llm?: { models?: string[]; loaded?: string[]; bonsai?: string };
  };
  return {
    engines: Object.entries(data.engines ?? {}).map(([id, e]) => ({ id, model: e.model, device: e.device })),
    defaultEngine: data.default ?? '',
    gpu: data.gpu ?? null,
    models: data.llm?.models ?? [],
    loaded: data.llm?.loaded ?? [],
    bonsai: data.llm?.bonsai ?? 'off',
  };
}

export const voiceReady = (voice: VoiceSettings): boolean => voice.enabled && !!voice.serverUrl.trim() && !!voice.key.trim();
