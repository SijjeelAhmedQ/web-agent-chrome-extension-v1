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

/** A reasoning model's thinking before it answers. */
export type ThinkingLevel = 'off' | 'low' | 'high';

export interface ProviderConfig {
  id: string;
  name: string;
  kind: ProviderKind;
  /** Preset this connection was created from, for its icon and hints. */
  preset: string;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  /** How much a reasoning model thinks before it answers: off is fastest. Unset → the model's own default. */
  thinking?: ThinkingLevel;
  /** @deprecated Read as `thinking: 'off'` — kept so older setups and backups keep their speed. */
  skipThinking?: boolean;
  /** Context window in tokens. Ollama: sent as `num_ctx`. Others: used to trim long tasks to fit. */
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

/**
 * A team: this agent splits a request between its member agents instead of doing it alone.
 * With `parallel`, every member works in its own tab at the same time.
 */
export interface TeamConfig {
  memberIds: string[];
  parallel: boolean;
  /** How many members work at once (the model server must answer that many requests together). */
  maxParallel: number;
  /** When every member is done: close their tabs and reload the page the request came from. */
  tidyUp: boolean;
}

export interface AutoModels {
  small: string;
  medium: string;
  big: string;
  chooser: string;
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
  /**
   * The decision model: it decides each next step (after a tool's result). The model above reads the
   * request first, double-checks and writes the answer. The user still approves every save. Unset → off.
   */
  decision?: { providerId: string | null; model: string } | null;
  /**
   * Models picked per task, on an OpenRouter connection: plain clicks go to `small` with no chooser; data analysis:
   * `small` does the clicks and reading, `chooser` picks who writes it; anything else: `chooser` picks the model and
   * decides each step. Replaces the model and decision model above. Unset → off.
   */
  autoModels?: AutoModels | null;
  temperature: number;
  maxSteps: number;
  /** Before reporting that something was done, re-read the page and check the claim (default on). */
  verify?: boolean;
  confirmation: ConfirmationPolicy;
  /** Built-in tool ids and custom tool ids (prefixed `custom:`). */
  toolIds: string[];
  skillIds: string[];
  /** Set when this agent coordinates a team. */
  team?: TeamConfig;
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

/**
 * rule       – always/never do this here (“Open a patient by clicking the name, never an icon”)
 * navigation – where things are and how to get there (menus, addresses)
 * page       – what a page or control means (columns, icons, buttons)
 * workflow   – how to do a task, step by step, for requests like an example
 */
export type KnowledgeKind = 'rule' | 'navigation' | 'page' | 'workflow';

/** One piece of what the user knows about a website. */
export interface KnowledgeEntry {
  id: string;
  kind: KnowledgeKind;
  title: string;
  /** Workflows: an example of what the user asks (“Goto Patients … select Arya Stark”). */
  trigger?: string;
  /** Markdown. For a workflow: the steps. */
  content: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * Site-based configuration: knowledge, skills, tools and model for one website. Used
 * automatically — on top of the agent's own setup — whenever the agent's tab is on it.
 */
export interface SiteProfile {
  id: string;
  name: string;
  description: string;
  color: string;
  /** Host patterns (e.g. `localhost:5173`, `*.indici.co.nz`). */
  sites: string[];
  enabled: boolean;
  /** Model for this site. null and '' → the agent's own. */
  providerId: string | null;
  model: string;
  /** Agents that work on this site; the first opens by itself in the side panel here. */
  agentIds: string[];
  /** Skills that apply on this site, for every agent. */
  skillIds: string[];
  /** Agents' own skills switched off on this site. */
  disabledSkillIds: string[];
  /** Custom tools available on this site, for every agent. */
  customToolIds: string[];
  /** Tools switched off on this site: built-in ids and custom tools as `custom:<id>`. */
  disabledToolIds: string[];
  /** Buttons and links the agent may never click here (exact names, e.g. “Pharmac”) — the user clicks them. */
  neverClick?: string[];
  /** Controls that change a record the moment they are clicked (a tick box that saves itself): asked about first. */
  askBefore?: string[];
  /**
   * Pop-ups only the user answers (words of their title or text, e.g. “New Zealand Formulary”): any of their
   * buttons is pressed only with the user's OK — unless the user's message names that button.
   */
  askPopups?: string[];
  knowledge: KnowledgeEntry[];
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
  /** Send the request as soon as the speech is transcribed (push-to-talk). */
  autoSend: boolean;
  /**
   * push      – click to start, click to stop
   * handsfree – the microphone stays on; each pause ends a command, which runs by itself
   */
  mode: 'push' | 'handsfree';
  /** Hands-free: how long a pause ends a command (ms). */
  pauseMs: number;
  /** Hands-free: show the words while you are still speaking. */
  livePartials: boolean;
  /** Hands-free: say “confirm” / “cancel” to answer approvals, “stop” to stop the agent. */
  voiceCommands: boolean;
}

/** The user's edits to a built-in tool (Configuration → Tools). Empty fields keep the default. */
export interface ToolOverride {
  /** What the model reads about the tool. */
  description?: string;
  /** Parameter name → what the model reads about it. */
  params?: Record<string, string>;
  /** Ask before every use, whatever the agent's approval setting. */
  alwaysAsk?: boolean;
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
  /** Keep a copy of the setup (without API keys) in Downloads/WebAgent — it outlives removing the extension. */
  autoBackup?: boolean;
  /** Put API keys in the backup file too (they are in plain text there). */
  backupKeys?: boolean;
  saveHistory: boolean;
  historyRetentionDays: number;
  developerMode: boolean;
  /** Built-in tools switched off everywhere. */
  disabledToolIds: string[];
  maxElements: number;
  maxTextChars: number;
  voice: VoiceSettings;
  /** Built-in tools that existed when this config was last saved (new ones get added to agents). */
  knownToolIds?: string[];
  /** Edited descriptions and approval settings of built-in tools, by tool id. */
  toolOverrides?: Record<string, ToolOverride>;
  /** When a click does nothing, click again with a real mouse click (Chrome's debugger). */
  realClicks?: boolean;
  /**
   * Dollars one task may spend on its models before it stops and waits (Resume carries on). 0: no limit.
   * Only servers that report a cost count (OpenRouter); Kaggle and local models cost nothing.
   */
  maxTaskCost?: number;
}

export interface AppConfig {
  version: 1;
  providers: ProviderConfig[];
  agents: AgentConfig[];
  skills: SkillConfig[];
  customTools: CustomToolConfig[];
  /** Site-based configuration (knowledge, skills, tools, model per website). */
  sites: SiteProfile[];
  settings: Settings;
}
