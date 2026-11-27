import type { PickableModel, ProviderKind, ThinkingLevel } from '../types/config';

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
  /** The thinking a new connection starts with. */
  thinking?: ThinkingLevel;
  hint: string;
  keyUrl?: string;
  keyHeader?: string;
  keyLabel?: string;
  timeoutMs?: number;
  models?: ModelOption[];
  /** Appended to a bare server address the user pastes. */
  apiPath?: string;
}

/** The notebooks run their models with this many tokens of context (CTX) — all but web_agent_qwen38long (65536). */
export const KAGGLE_CONTEXT_WINDOW = 16384;

/** Qwen models people run in Ollama on their own computer. */
export const OLLAMA_MODELS: ModelOption[] = [
  { id: 'qwen3.5:9b', label: 'Qwen 3.5 9B', note: 'Better at multi-step tasks. Needs about 7 GB of GPU memory.', tools: true },
  { id: 'qwen3.5:4b', label: 'Qwen 3.5 4B', note: 'Runs on a 4 GB GPU. Slower and less reliable on complex sites.', tools: true },
];

/** The models the Kaggle notebooks serve: kaggle/careflow_kaggle.ipynb, and the Web Agent's own (kaggle/make_web_agent_notebook.py). */
export const KAGGLE_MODELS: ModelOption[] = [
  { id: 'qwen3.5:9b', label: 'Qwen 3.5 9B', note: 'Calls tools reliably — the best default for actions.', tools: true },
  { id: 'ternary-bonsai-2-27b', label: 'Ternary Bonsai 2 27B', note: 'The strongest model. Needs the notebook on GPU T4 x2.', tools: true },
  { id: 'qwen3.8:27b-q4_K_M', label: 'Qwen3.8 27B', note: 'Follows long workflows best — the web_agent_qwen38 notebook (GPU T4 x2), or web_agent_qwen38long for long requests (Context window 65536). Slower: a few minutes a task.', tools: true },
  { id: 'qwen3-vl:4b-instruct-q8_0', label: 'Qwen3-VL 4B Instruct', note: 'Small and fast, sees images too — the web_agent_qwen3vl4b notebook (one T4). Less reliable on long workflows.', tools: true },
  { id: 'hf.co/unsloth/medgemma-4b-it-GGUF:Q4_K_M', label: 'MedGemma 4B', note: 'Medical knowledge. Can’t use tools — reads the page and answers, but can’t click or type.', tools: false },
];

/**
 * What a task on a server that reports no cost (Kaggle, Ollama) would cost on OpenRouter's default agent model,
 * in dollars per million tokens — OpenRouter's listed price for Gemini 3.8 Flash, November 2026.
 */
export const REFERENCE_PRICE = { model: 'Gemini 3.8 Flash', input: 0.825, cachedInput: 0.0825, output: 4.125 };

/** Fast models on OpenRouter for the agent, and Jev Router for its decisions (see each agent's Decision model). */
export const OPENROUTER_MODELS: ModelOption[] = [
  { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash', note: 'Fast, with tools. Thinking Off is cheapest; Low for harder tasks.', tools: true },
  { id: '~deepseek/deepseek-flash-latest', label: 'DeepSeek Flash', note: 'Cheapest here, with tools: good for clicks and going to pages. The whole conversation is cached.', tools: true },
  { id: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5', note: 'Fast, follows workflows closely. Thinking Off is cheapest; Low for harder tasks.', tools: true },
  { id: 'typesafe/jev-router', label: 'Jev Router', note: 'Picks a model and its thinking for each request — use it as an agent’s Decision model. Its price varies by request.', tools: true },
];

/** The decision model an agent starts with when it is switched on. */
export const DEFAULT_DECISION_MODEL = 'typesafe/jev-router';

/** The list a new setup starts with: OpenRouter's fast models with tools, the cheapest first. */
export const DEFAULT_PICKABLE_MODELS: PickableModel[] = [
  { id: '~deepseek/deepseek-flash-latest', note: 'Good for clicks, going to pages and simple reading.', tools: true },
  { id: 'anthropic/claude-haiku-5.5', note: 'Follows workflows closely: forms, adding and saving records.', tools: true },
  { id: 'google/gemini-3.8-flash', note: 'Good at data analysis, summaries and comparing records.', tools: true },
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
    thinking: 'off',
    models: OLLAMA_MODELS,
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
    thinking: 'off',
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
    model: 'google/gemini-3.8-flash',
    needsKey: true,
    local: false,
    // Thinking is paid as output (five times the input's price) on every step: off unless the user turns it up.
    thinking: 'off',
    models: OPENROUTER_MODELS,
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
  return /medgemma/.test(name) ? KAGGLE_MODELS.find((m) => /medgemma/i.test(m.id)) : undefined;
};

/** “Qwen 3.5 9B” for known models, the model id as it is otherwise. */
export const modelLabel = (id: string): string => knownModel(id)?.label ?? id;

export type Location = 'kaggle' | 'local' | 'cloud' | 'server';

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/;

/** Where a server runs, in words: “This computer · Ollama”, “Kaggle GPU · hosted”, “Cloud · OpenRouter”. */
export function locationOf(url: string, preset?: string): { kind: Location; label: string; host: string } {
  let host = '';
  let hostname = '';
  try {
    const u = new URL(url);
    host = u.host;
    hostname = u.hostname;
  } catch {
    /* not a URL */
  }
  if (preset === 'kaggle' || /\.trycloudflare\.com$|kaggle/i.test(hostname)) return { kind: 'kaggle', label: 'Kaggle GPU · hosted', host };
  if (LOCAL_HOST.test(hostname)) {
    const what = preset === 'careflow-bridge' ? 'CareFlow bridge' : preset && preset !== 'custom' ? presetById(preset).label : /:11434$/.test(host) ? 'Ollama' : 'local server';
    return { kind: 'local', label: `This computer · ${what}`, host };
  }
  const cloud = preset && ['openrouter', 'openai', 'anthropic'].includes(preset) ? presetById(preset).label : '';
  return cloud ? { kind: 'cloud', label: `Cloud · ${cloud}`, host } : { kind: 'server', label: host || 'Server', host };
}

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
