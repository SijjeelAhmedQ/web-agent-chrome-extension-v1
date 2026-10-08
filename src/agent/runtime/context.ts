import type { ChatMessage } from '../llm/types';

const SNAPSHOT_TOOLS = new Set(['read_page']);
const MAX_TOOL_CHARS = 20_000;
const PLACEHOLDER = '[Earlier page snapshot removed — its element ids are no longer valid.]';

const size = (messages: ChatMessage[]) => messages.reduce((n, m) => n + m.content.length, 0);

/**
 * Keeps the conversation within `budgetChars`. Nothing changes while it fits, so the
 * prompt only ever grows at the end and model servers can reuse their prompt cache
 * (rewriting earlier turns forces a full re-read, which is slow on local models). Once the
 * budget is exceeded, every page snapshot except the latest is dropped in one go, then
 * long older tool results are trimmed if needed. Mutates and returns the array.
 */
export function compactMessages(messages: ChatMessage[], budgetChars: number): ChatMessage[] {
  if (size(messages) <= budgetChars) return messages;
  let latestSeen = false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'tool' && SNAPSHOT_TOOLS.has(m.toolName)) {
      if (latestSeen && m.content !== PLACEHOLDER) messages[i] = { ...m, content: PLACEHOLDER };
      latestSeen = true;
    }
  }
  let total = size(messages);
  const lastIndex = messages.length - 1;
  for (let i = 0; i < lastIndex && total > budgetChars; i++) {
    const m = messages[i];
    if (m.role === 'tool' && m.content.length > 600 && m.content !== PLACEHOLDER) {
      total -= m.content.length - 600;
      messages[i] = { ...m, content: `${m.content.slice(0, 600)}\n[…trimmed]` };
    }
  }
  return messages;
}

/** Room for the conversation, in characters, given a model's context window in tokens. */
export function budgetFor(contextTokens: number | undefined): number {
  if (!contextTokens) return 60_000;
  // ~3.5 characters per token; keep ~3k tokens for the system prompt, tool definitions and the reply.
  return Math.max(8_000, Math.round((contextTokens - 3_000) * 3.5));
}

export function clipToolOutput(text: string): string {
  return text.length > MAX_TOOL_CHARS ? `${text.slice(0, MAX_TOOL_CHARS)}\n[…output truncated]` : text;
}
