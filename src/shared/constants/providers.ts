import type { ProviderKind } from '../types/config';

/** A model a preset's server is known to offer. */
export interface ModelOption {
  id: string;
  label: string;
  note: string;
  /** Can call tools — needed to click, type and navigate. */
  tools: boolean;
}

export interface ProviderPreset {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  needsKey: boolean;
  local: boolean;
  /** Default for “Skip thinking”. */
  skipThinking?: boolean;
  hint: string;
  keyUrl?: string;
  keyHeader?: string;
  keyLabel?: string;
  timeoutMs?: number;
  models?: ModelOption[];
  /** Appended to a bare server address the user pastes. */
  apiPath?: string;
}

/** The models the CareFlow Kaggle notebook (kaggle/careflow_kaggle.ipynb) serves. */
export const KAGGLE_MODELS: ModelOption[] = [
  { id: 'qwen3.5:9b', label: 'Qwen 3.5 9B', note: 'Calls tools reliably — the best default for actions.', tools: true },
  { id: 'ternary-bonsai-2-27b', label: 'Ternary Bonsai 2 27B', note: 'The strongest model. Needs the notebook on GPU T4 x2.', tools: true },
  { id: 'hf.co/unsloth/medgemma-4b-it-GGUF:Q4_K_M', label: 'MedGemma 4B', note: 'Medical knowledge. Can’t use tools — reads the page and answers, but can’t click or type.', tools: false },
];

/** Starting points for a new connection. Every field stays editable. */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'ollama',
    label: 'Ollama',
    kind: 'ollama',
    baseUrl: 'http://localhost:11434',
    model: 'qwen3.5:4b',
    needsKey: false,
    local: true,
    skipThinking: true,
    hint: 'Runs on this computer. Use a model that supports tool calling (Qwen 3, Llama 3.1+, Mistral).',
  },
  {
    id: 'careflow-bridge',
    label: 'CareFlow bridge',
    kind: 'ollama',
    baseUrl: 'http://127.0.0.1:8765/ollama',
    model: 'qwen3.5:4b',
    needsKey: false,
    local: true,
    skipThinking: true,
    hint: 'The CareFlow FastAPI bridge, forwarding to Ollama. For its vLLM or OpenRouter routes, use “Other (OpenAI-compatible)” with /vllm/v1 or /openrouter/api/v1.',
  },
  {
    id: 'kaggle',
    label: 'Kaggle GPU',
    kind: 'openai',
    baseUrl: '',
    model: 'qwen3.5:9b',
    needsKey: true,
    local: false,
    hint: 'Run kaggle/careflow_kaggle.ipynb on Kaggle (Accelerator: GPU T4 x2, Internet on), then paste the address and key it prints.',
    keyHeader: 'X-CareFlow-Key',
    keyLabel: 'Notebook key',
    timeoutMs: 600_000,
    models: KAGGLE_MODELS,
    apiPath: '/vllm/v1',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'qwen/qwen3-30b-a3b',
    needsKey: true,
    local: false,
    hint: 'One key for hundreds of models. Choose one that supports tools.',
    keyUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    needsKey: true,
    local: false,
    hint: 'Uses the OpenAI API with your key.',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-5-5',
    needsKey: true,
    local: false,
    hint: 'Uses Claude through the Anthropic API with your key.',
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    kind: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    model: '',
    needsKey: false,
    local: true,
    hint: 'Start the local server in LM Studio first.',
  },
  {
    id: 'llamacpp',
    label: 'llama.cpp',
    kind: 'openai',
    baseUrl: 'http://localhost:8080/v1',
    model: '',
    needsKey: false,
    local: true,
    hint: 'Start llama-server with --jinja so tool calling works.',
  },
  {
    id: 'vllm',
    label: 'vLLM',
    kind: 'openai',
    baseUrl: 'http://localhost:8000/v1',
    model: '',
    needsKey: false,
    local: true,
    hint: 'Start vLLM with --enable-auto-tool-choice and a tool-call parser.',
  },
  {
    id: 'custom',
    label: 'Other (OpenAI-compatible)',
    kind: 'openai',
    baseUrl: '',
    model: '',
    needsKey: false,
    local: false,
    hint: 'Any server that implements /chat/completions with tools.',
  },
];

export const presetById = (id: string): ProviderPreset =>
  PROVIDER_PRESETS.find((p) => p.id === id) ?? PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1];

/** What we know about a model by name, from any preset. */
export const knownModel = (id: string): ModelOption | undefined => {
  const name = id.trim().toLowerCase();
  if (!name) return undefined;
  for (const preset of PROVIDER_PRESETS) {
    const found = preset.models?.find((m) => m.id.toLowerCase() === name);
    if (found) return found;
  }
  return /medgemma/.test(name) ? KAGGLE_MODELS[2] : undefined;
};

/** A pasted server address with the preset's API path added when it has none. */
export function withApiPath(url: string, apiPath?: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!apiPath) return trimmed;
  try {
    const u = new URL(trimmed);
    return u.pathname === '/' || u.pathname === '' ? `${u.origin}${apiPath}` : trimmed;
  } catch {
    return trimmed;
  }
}
