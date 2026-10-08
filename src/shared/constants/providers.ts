import type { ProviderKind } from '../types/config';

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
}

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
