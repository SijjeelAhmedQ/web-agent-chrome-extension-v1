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
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
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
}

export interface ChatResponse {
  content: string;
  toolCalls: ToolCall[];
  finishReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface LlmClient {
  chat(request: ChatRequest): Promise<ChatResponse>;
  listModels(signal?: AbortSignal): Promise<string[]>;
}
