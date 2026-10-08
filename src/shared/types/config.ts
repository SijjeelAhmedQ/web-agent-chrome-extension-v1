/**
 * Everything the user can configure. Persisted as one document in chrome.storage.local
 * (see shared/storage/configStore.ts) and shared live between the side panel, the
 * configuration page and the background worker.
 */

export type ThemeMode = 'system' | 'light' | 'dark';
export type TextSize = 'default' | 'large';

/** How the agent talks to a model. `openai` covers every OpenAI-compatible server (OpenAI,
 * OpenRouter, LM Studio, llama.cpp, vLLM…); `ollama` uses Ollama's native API so the
 * context window can be set. */
export type ProviderKind = 'openai' | 'anthropic' | 'ollama';

export interface ProviderConfig {
  id: string;
  name: string;
  kind: ProviderKind;
  /** Preset this connection was created from, for its icon and hints. */
  preset: string;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  /** Ask reasoning models to answer without a thinking phase (`reasoning_effort: "none"`). Much faster on local models. */
  skipThinking?: boolean;
  /** Ollama only: context window in tokens (`num_ctx`). */
  contextWindow?: number;
  /** Send the API key in this header instead of `Authorization: Bearer` (e.g. `X-CareFlow-Key`). */
  keyHeader?: string;
  /** How long to wait for one answer. Remote GPUs behind a tunnel can take minutes to load a model. */
  timeoutMs?: number;
  createdAt: number;
}

/**
 * smart  – ask before actions that buy, send, delete, submit or change settings
 * always – ask before every action that changes a page
 * never  – act without asking (autonomous)
 */
export type ConfirmationPolicy = 'smart' | 'always' | 'never';

export interface AgentAvatar {
  icon: string;
  color: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  avatar: AgentAvatar;
  /** Extra instructions appended to the built-in system prompt. */
  instructions: string;
  /** null → the default connection from settings. */
  providerId: string | null;
  /** Empty → the connection's default model. */
  model: string;
  temperature: number;
  maxSteps: number;
  confirmation: ConfirmationPolicy;
  /** Built-in tool ids and custom tool ids (prefixed `custom:`). */
  toolIds: string[];
  skillIds: string[];
  createdAt: number;
  updatedAt: number;
}

/** always – instructions are always in the agent's prompt
 *  on-demand – only the name/description is; the agent loads it when relevant */
export type SkillActivation = 'always' | 'on-demand';

export interface SkillConfig {
  id: string;
  name: string;
  description: string;
  instructions: string;
  activation: SkillActivation;
  /** Host patterns (e.g. `*.example.com`, `localhost:5173`). Empty → every site. */
  sites: string[];
  createdAt: number;
  updatedAt: number;
}

export type ToolParamType = 'string' | 'number' | 'boolean';

export interface CustomToolParam {
  name: string;
  type: ToolParamType;
  description: string;
  required: boolean;
}

/** A tool the user defines that calls an HTTP endpoint (their own backend, a webhook…). */
export interface CustomToolConfig {
  id: string;
  /** Identifier the model sees, snake_case. */
  name: string;
  label: string;
  description: string;
  method: 'GET' | 'POST';
  url: string;
  /** Extra request headers, one `Name: value` per line. */
  headers: string;
  params: CustomToolParam[];
  needsApproval: boolean;
  createdAt: number;
  updatedAt: number;
}

export type SpeechEngine = 'whisper' | 'omi';

/** Voice input: speech is recorded in the side panel and transcribed by a speech server (the Kaggle notebook). */
export interface VoiceSettings {
  enabled: boolean;
  /** Address of the speech server, e.g. https://xyz.trycloudflare.com */
  serverUrl: string;
  key: string;
  engine: SpeechEngine;
  /** Names and terms to expect (Whisper only) — patients, drugs, products… */
  vocabulary: string;
  /** Send the request as soon as the speech is transcribed. */
  autoSend: boolean;
}

export interface Settings {
  theme: ThemeMode;
  textSize: TextSize;
  reduceMotion: boolean;
  defaultAgentId: string;
  defaultProviderId: string | null;
  showSuggestions: boolean;
  highlightActions: boolean;
  expandActivity: boolean;
  blockedSites: string[];
  readOnlySites: string[];
  saveHistory: boolean;
  historyRetentionDays: number;
  developerMode: boolean;
  /** Built-in tools switched off everywhere. */
  disabledToolIds: string[];
  maxElements: number;
  maxTextChars: number;
  voice: VoiceSettings;
}

export interface AppConfig {
  version: 1;
  providers: ProviderConfig[];
  agents: AgentConfig[];
  skills: SkillConfig[];
  customTools: CustomToolConfig[];
  settings: Settings;
}
