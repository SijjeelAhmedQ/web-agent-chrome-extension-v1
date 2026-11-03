import type { ModelCallRecord } from '@/shared/types/history';
import type { ChatMessage, ChatRequest, ChatResponse, LlmClient } from '../llm/types';
import { estimateTokens, isPageRead } from './context';

/**
 * What a prompt is made of, in estimated tokens: the site knowledge, the rest of the system prompt, the tool
 * definitions, page reads and everything else (the request, steps, earlier answers). Shows what to cut.
 */
export function promptParts(messages: ChatMessage[], tools: ChatRequest['tools'], knowledge: string): ModelCallRecord['parts'] {
  const parts = { system: 0, knowledge: 0, tools: tools.length ? estimateTokens(JSON.stringify(tools)) : 0, pages: 0, rest: 0 };
  for (const m of messages) {
    const n = estimateTokens(m.content) + (m.role === 'assistant' && m.toolCalls?.length ? estimateTokens(JSON.stringify(m.toolCalls)) : 0);
    if (m.role === 'system') {
      const k = knowledge && m.content.includes(knowledge) ? estimateTokens(knowledge) : 0;
      parts.knowledge += k;
      parts.system += n - k;
    } else if (isPageRead(m) || (m.role === 'user' && m.content.includes('\nCurrent page:\n'))) parts.pages += n;
    else parts.rest += n;
  }
  return parts;
}

/** A tool call's arguments in a few words: `"Arya STARK" then_click 13`, `Patients › Search & List`, `3 fields`. */
function argsInShort(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([key, v]) => {
      if (typeof v === 'string') return `"${v.length > 40 ? `${v.slice(0, 40)}…` : v}"`;
      if (typeof v === 'number') return key === 'id' ? String(v) : `${key} ${v}`;
      if (typeof v === 'boolean') return v ? key : '';
      if (Array.isArray(v)) return v.every((x) => typeof x === 'string') ? v.join(' › ') : `${v.length} ${key}`;
      return '';
    })
    .filter(Boolean)
    .join(' ');
}

/** What a reply did, in short: each tool it called with its arguments, or the start of its answer. */
export function replyInShort(res: ChatResponse): string {
  const text = res.toolCalls.length
    ? res.toolCalls.map((c) => [c.name, argsInShort(c.arguments ?? {})].filter(Boolean).join(' ')).join('; ')
    : `answer: ${res.content.trim().replace(/\s+/g, ' ')}`;
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

/**
 * A client that logs every call: what it was for, its tokens and its cost — as the server reports them, or
 * the input estimated when it reports none. `onCall` gets each record when the reply is in; `before` runs before
 * each call and may throw to stop it (the task's spending limit).
 */
export function meteredClient(
  client: LlmClient,
  role: ModelCallRecord['role'],
  knowledge: () => string,
  onCall: (call: ModelCallRecord) => void,
  before: () => void = () => undefined,
): LlmClient {
  return {
    listModels: (signal) => client.listModels(signal),
    async chat(req) {
      before();
      const at = Date.now();
      const parts = promptParts(req.messages, req.tools, knowledge());
      const res = await client.chat(req);
      const u = res.usage ?? {};
      const estimated = u.inputTokens === undefined;
      onCall({
        at,
        durationMs: Date.now() - at,
        role,
        purpose: req.purpose ?? (role === 'decider' ? 'Deciding the next step' : 'Doing a step'),
        model: req.model,
        ...(u.servedBy && u.servedBy !== req.model ? { servedBy: u.servedBy } : {}),
        inputTokens: u.inputTokens ?? parts.system + parts.knowledge + parts.tools + parts.pages + parts.rest,
        ...(u.cachedTokens ? { cachedTokens: u.cachedTokens } : {}),
        ...(u.outputTokens !== undefined ? { outputTokens: u.outputTokens } : {}),
        ...(u.reasoningTokens ? { reasoningTokens: u.reasoningTokens } : {}),
        ...(u.cost !== undefined ? { cost: u.cost } : {}),
        ...(estimated ? { estimated } : {}),
        did: replyInShort(res),
        parts,
      });
      return res;
    },
  };
}
