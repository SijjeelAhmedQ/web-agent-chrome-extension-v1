import type { ChatMessage } from '../llm/types';
import { DIFF_HEAD } from '../tools/pageDiff';

const SNAPSHOT_TOOLS = new Set(['read_page']);
const MAX_TOOL_CHARS = 20_000;
const PLACEHOLDER = '[Earlier page snapshot removed — its element ids are no longer valid.]';
const RUNTIME_PROMPT = /^(Before you finish|Not finished yet:|Your last reply was cut off|You have not finished the task yet)/;
const EARLIER_STEP = '[Result of an earlier step — removed to fit; it was done.]';
/** The first line of a step the user approved: kept however tight the room, so what was done is not forgotten. */
export const APPROVED_DONE = 'Done with the user’s approval:';
/** The least of the latest page the model keeps, in tokens, however tight the budget. */
const MIN_PAGE_TOKENS = 1_200;
const SHRUNK_NOTE = '[…page list shortened to fit the model’s memory — use find_element or click_text for something not listed]';

/**
 * Tokens a text takes, roughly and on the safe side. Page snapshots are full of ids, dates and
 * phone numbers, and models like Qwen spend a token on every digit — so digits count one each,
 * the rest about 3.2 characters a token.
 */
export function estimateTokens(text: string): number {
  const digits = text.match(/\d/g)?.length ?? 0;
  return digits + Math.ceil((text.length - digits) / 3.2);
}

// A step's call (its arguments) is sent too: counted, or a long task runs past the model's context unseen.
const tokensOf = (m: ChatMessage) => estimateTokens(m.content) + 4 + (m.role === 'assistant' && m.toolCalls?.length ? estimateTokens(JSON.stringify(m.toolCalls)) : 0);
const size = (messages: ChatMessage[]) => messages.reduce((n, m) => n + tokensOf(m), 0);

/**
 * Keeps the conversation within `budgetTokens`. Nothing changes while it fits, so the prompt
 * only ever grows at the end and model servers can reuse their prompt cache (rewriting earlier
 * turns forces a full re-read, which is slow on local models). Once over budget: every page
 * snapshot except the latest is dropped, then long older tool results are trimmed, then long
 * earlier chat turns, and last the latest page itself — so the prompt always fits. A prompt over
 * the model's context is cut from the front by the server, losing the user's request.
 * Mutates and returns the array.
 */
export function compactMessages(messages: ChatMessage[], budgetTokens: number): ChatMessage[] {
  if (size(messages) <= budgetTokens) return messages;
  // The latest full read of a page stays, with the reads of only its changes after it; earlier reads go.
  const isRead = (m: ChatMessage) => m.role === 'tool' && SNAPSHOT_TOOLS.has(m.toolName) && m.content !== PLACEHOLDER;
  let latest = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isRead(messages[i]) && !messages[i].content.startsWith(DIFF_HEAD)) {
      latest = i;
      break;
    }
  }
  for (let i = 0; i < messages.length; i++) {
    if (isRead(messages[i]) && i < latest) messages[i] = { ...messages[i], content: PLACEHOLDER };
  }
  // The latest look-up of the site's knowledge is how the step now is done (fill “Take”, not “Quantity”):
  // it stays whole like the latest page, until a newer one.
  const howTo = messages.findLastIndex((m) => m.role === 'tool' && m.toolName === 'site_knowledge');
  let total = size(messages);
  const lastIndex = messages.length - 1;
  for (let i = 0; i < lastIndex && total > budgetTokens; i++) {
    const m = messages[i];
    if (i !== latest && i !== howTo && m.role === 'tool' && m.content.length > 600 && m.content !== PLACEHOLDER && !(i > latest && latest >= 0 && m.content.startsWith(DIFF_HEAD))) {
      total -= tokensOf(m);
      messages[i] = { ...m, content: `${m.content.slice(0, 600)}\n[…trimmed]` };
      total += tokensOf(messages[i]);
    }
  }
  // Earlier turns of the chat (before this request): their gist is enough.
  // The user's request — not the runtime's own prompts after it (the double-check, “not finished yet”…).
  const request = messages.findLastIndex((m) => m.role === 'user' && !RUNTIME_PROMPT.test(m.content));
  for (let i = 1; i < request && total > budgetTokens; i++) {
    const m = messages[i];
    if ((m.role === 'user' || m.role === 'assistant') && m.content.length > 500) {
      total -= tokensOf(m);
      messages[i] = { ...m, content: `${m.content.slice(0, 500)} […]` };
      total += tokensOf(messages[i]);
    }
  }
  // Many short results add up over a long task: older steps keep only that they happened (their calls stay —
  // each result still answers its call). Not the latest page read, nor the changes read after it (they stand
  // on it), nor the last few steps.
  const keepFrom = lastIndex - 6;
  const chain = (i: number) => i === latest || (latest >= 0 && i > latest && isRead(messages[i]) && messages[i].content.startsWith(DIFF_HEAD));
  for (let i = request + 1; i < keepFrom && total > budgetTokens; i++) {
    const m = messages[i];
    if (chain(i) || i === howTo) continue;
    if (m.role === 'tool' && m.content !== PLACEHOLDER && m.content.length > 80) {
      total -= tokensOf(m);
      const first = m.content.split('\n')[0];
      messages[i] = { ...m, content: first.startsWith(APPROVED_DONE) ? `${first.slice(0, 240)}\n${EARLIER_STEP}` : EARLIER_STEP };
      total += tokensOf(messages[i]);
    } else if (m.role === 'assistant' && m.content.length > 80) {
      total -= tokensOf(m);
      messages[i] = { ...m, content: '' };
      total += tokensOf(messages[i]);
    }
  }
  if (total > budgetTokens && latest >= 0) {
    const m = messages[latest];
    const room = Math.max(MIN_PAGE_TOKENS, budgetTokens - (total - tokensOf(m)));
    total -= tokensOf(m);
    messages[latest] = { ...m, content: shrinkSnapshot(m.content, room) };
    total += tokensOf(messages[latest]);
  }
  // The runtime's own prompts after the request can carry a whole page (the double-check before
  // answering): on a small context they are shortened too, or the server cuts the request instead.
  for (let i = messages.length - 1; i > request && total > budgetTokens; i--) {
    const m = messages[i];
    if (m.role !== 'user' || m.content.length < 2_000) continue;
    const room = Math.max(MIN_PAGE_TOKENS, budgetTokens - (total - tokensOf(m)));
    total -= tokensOf(m);
    messages[i] = { ...m, content: shrinkSnapshot(m.content, room) };
    total += tokensOf(messages[i]);
  }
  // Still over: the server would cut the prompt from the front and lose the request (Ollama: “no user query
  // found”). Last resort — every step after the request, oldest first, the newest ones and the chain too,
  // is cut down; the latest page stays at its least.
  for (let i = request + 1; i < messages.length && total > budgetTokens; i++) {
    const m = messages[i];
    if (i === latest || m.content.length <= 400) continue;
    const room = Math.max(100, budgetTokens - (total - tokensOf(m)));
    const keep = Math.max(300, Math.min(m.content.length - 1, room * 3));
    total -= tokensOf(m);
    messages[i] = { ...m, content: `${m.content.slice(0, keep)}\n[…cut to fit]` };
    total += tokensOf(messages[i]);
  }
  return messages;
}

/**
 * A page snapshot cut down to about `tokens`: first its page text (the element list says what
 * can be done), then elements outside the visible area, then whatever is at the end.
 */
export function shrinkSnapshot(text: string, tokens: number): string {
  if (estimateTokens(text) <= tokens) return text;
  let out = text.replace(/\n\n(Visible text \(start\)|Page text|Headings):[\s\S]*$/, '');
  if (estimateTokens(out) + 40 > tokens) out = out.split('\n').filter((l) => !(/^\[\d+\] /.test(l) && l.endsWith(' ↓'))).join('\n');
  if (estimateTokens(out) + 40 > tokens) {
    const lines = out.split('\n');
    let used = 0;
    const kept: string[] = [];
    for (const l of lines) {
      used += estimateTokens(l) + 1;
      if (used + 40 > tokens) break;
      kept.push(l);
    }
    out = kept.join('\n');
  }
  return `${out}\n${SHRUNK_NOTE}`;
}

/** Room for the conversation, in tokens, given a model's context window: all of it but the reply. */
export function budgetFor(contextTokens: number | undefined): number {
  // No limit given: a cloud model with a large context — room for a site's knowledge (up to ~12k tokens) and big pages.
  if (!contextTokens) return 56_000;
  return Math.max(4_000, contextTokens - 1_500);
}

export function clipToolOutput(text: string): string {
  return text.length > MAX_TOOL_CHARS ? `${text.slice(0, MAX_TOOL_CHARS)}\n[…output truncated]` : text;
}
