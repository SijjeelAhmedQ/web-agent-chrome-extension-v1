/**
 * Provider-neutral chat types. The agent runtime only speaks these; each adapter maps them
 * to its wire format. Adding a provider = one file implementing `LlmClient`.
 */

export type JsonSchema = Record<string, unknown>;

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /** Set when the model sent arguments that weren't valid JSON. */
  parseError?: string;
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[]; reasoning?: unknown; reasoningBy?: string }
  | { role: 'tool'; content: string; toolCallId: string; toolName: string };

export interface ToolSpec {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  temperature: number;
  signal?: AbortSignal;
  /** What the call is for, for the task's log (“Doing a step”) — not sent. */
  purpose?: string;
}

/** What a call used, as the server reports it. Each field only when the server sends it. */
export interface Usage {
  inputTokens?: number;
  /** Of the input, read from the server's prompt cache (billed at a fraction). */
  cachedTokens?: number;
  outputTokens?: number;
  /** Of the output, the model's thinking. */
  reasoningTokens?: number;
  /** In dollars (OpenRouter). */
  cost?: number;
  /** The model that answered — a router (Jev Router) picks one per request. */
  servedBy?: string;
  /** Headroom's compression of this call's messages: tokens before and after, as its proxy counted them. */
  headroom?: { before: number; after: number };
}

export interface ChatResponse {
  content: string;
  toolCalls: ToolCall[];
  finishReason?: string;
  usage?: Usage;
  /**
   * The model's reasoning as the provider sent it (OpenRouter's reasoning_details, Anthropic's thinking
   * blocks): sent back with this turn, or models that think while calling tools (Gemini 3, Claude) refuse.
   */
  reasoning?: unknown;
}

export interface LlmClient {
  chat(request: ChatRequest): Promise<ChatResponse>;
  listModels(signal?: AbortSignal): Promise<string[]>;
}
