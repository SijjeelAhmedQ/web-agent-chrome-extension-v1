import type { ProviderConfig } from '@/shared/types/config';
import { AnthropicClient } from './anthropic';
import { OllamaClient } from './ollama';
import { OpenAICompatibleClient } from './openaiCompatible';
import type { LlmClient } from './types';

export function createClient(provider: ProviderConfig): LlmClient {
  switch (provider.kind) {
    case 'anthropic':
      return new AnthropicClient(provider);
    case 'ollama':
      return new OllamaClient(provider);
    case 'openai':
    default:
      return new OpenAICompatibleClient(provider);
  }
}

export type { ChatMessage, ChatResponse, LlmClient, ToolCall, ToolSpec } from './types';
