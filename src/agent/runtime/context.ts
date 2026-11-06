import type { ChatMessage } from '../llm/types';
import { DIFF_HEAD } from '../tools/pageDiff';

const SNAPSHOT_TOOLS = new Set(['read_page']);
const MAX_TOOL_CHARS = 20_000;
const PLACEHOLDER = '[Earlier page snapshot removed — its element ids are no longer valid.]';
/**
 * The head of the page read for the model before its first call (it would spend a whole call asking for it).
 * A runtime message, not the user's request; a page read like any other, dropped once a newer one is in.
 */
export const FIRST_PAGE = '(The page as the task starts — read for you, as read_page would; its ids are valid:)';
const RUNTIME_PROMPT = /^(Before you finish|Not finished yet:|Your last reply was cut off|You have not finished the task yet|Decision \(from|\(The page as the task starts|\(Already done|\(Patient open in the consult)/;

/**
 * The head of the page read for the model after an action that changed it, added to that action's result
 * (reading it would be the model's next step — a whole call).
 */
export const PAGE_AFTER = '(The page now — read for you after this step, as read_page would:)';

/**
 * The page read a message holds, null for none: a read_page result, the page read before the first call, or
 * the page added to an action's result.
 */
export function pageIn(m: ChatMessage): string | null {
  if (m.role === 'tool' && SNAPSHOT_TOOLS.has(m.toolName)) return m.content;
  if (m.role === 'user' && m.content.startsWith(FIRST_PAGE)) return m.content.slice(FIRST_PAGE.length).trimStart();
  const at = m.role === 'tool' ? m.content.indexOf(`\n\n${PAGE_AFTER}\n`) : -1;
  return at < 0 ? null : m.content.slice(at + PAGE_AFTER.length + 3);
}
export const isPageRead = (m: ChatMessage): boolean => pageIn(m) !== null;
/** A whole read of a page — not one of only what changed since the last. */
export const isFullRead = (m: ChatMessage): boolean => {
  const page = pageIn(m);
  return page !== null && !page.startsWith(DIFF_HEAD) && !page.endsWith(PLACEHOLDER);
};
/** A message's page read, gone: what came before it (an action's result, the head) stays. */
function withoutPage(m: ChatMessage): ChatMessage {
  if (m.role === 'user') return { ...m, content: `${FIRST_PAGE} ${PLACEHOLDER}` };
  const at = m.content.indexOf(`\n\n${PAGE_AFTER}\n`);
  return { ...m, content: at < 0 ? PLACEHOLDER : `${m.content.slice(0, at)}\n${PLACEHOLDER}` };
}
/**
 * The task moved to another site: the pages of the site before go, all but the latest read, or they go with every
 * call there. The instructions changed at that moment, so the server's prompt cache has nothing to lose. Mutates.
 */
export function dropEarlierPages(messages: ChatMessage[]): void {
  const latest = messages.findLastIndex(isFullRead);
  for (let i = 0; i < latest; i++) {
    if (isPageRead(messages[i]) && !messages[i].content.endsWith(PLACEHOLDER)) messages[i] = withoutPage(messages[i]);
  }
}

const EARLIER_STEP = '[Result of an earlier step — removed to fit; it was done.]';
/** The first line of a step the user approved: kept however tight the room, so what was done is not forgotten. */
export const APPROVED_DONE = 'Done with the user’s approval:';
/** A cloud model's room for the conversation, in tokens (it was 56k: a simple task's calls grew to 30k each). */
export const CLOUD_BUDGET = 24_000;
/** How far under its room a conversation is cut once over it. */
const COMPACT_TO = 0.75;
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
// So is its reasoning, sent back with it (a thinking model's signatures).
const tokensOf = (m: ChatMessage) =>
  estimateTokens(m.content) +
  4 +
  (m.role === 'assistant' && m.toolCalls?.length ? estimateTokens(JSON.stringify(m.toolCalls)) : 0) +
  (m.role === 'assistant' && m.reasoning ? Math.ceil(JSON.stringify(m.reasoning).length / 4) : 0);
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
  // Once over, older steps are cut to well under the room (not just under it), so the next several calls only add
  // at the end: every cut rewrites the prompt from that point, and the server's prompt cache can't serve it.
  // The latest page is never cut to that lower mark — only to the room itself (below).
  const target = Math.floor(budgetTokens * COMPACT_TO);
  // The latest full read of a page stays, with the reads of only its changes after it; earlier reads go.
  const isRead = (m: ChatMessage) => isPageRead(m) && !m.content.endsWith(PLACEHOLDER);
  const isDiff = (m: ChatMessage) => !!pageIn(m)?.startsWith(DIFF_HEAD);
  const latest = messages.findLastIndex(isFullRead);
  for (let i = 0; i < messages.length; i++) {
    // (The page read before the first call keeps its head: it is the runtime's, not the user's request; an
    // action's result keeps what the action did.)
    if (isRead(messages[i]) && i < latest) messages[i] = withoutPage(messages[i]);
  }
  // The latest look-up of the site's knowledge is how the step now is done (fill “Take”, not “Quantity”):
  // it stays whole like the latest page, until a newer one.
  const howTo = messages.findLastIndex((m) => m.role === 'tool' && m.toolName === 'site_knowledge');
  let total = size(messages);
  const lastIndex = messages.length - 1;
  for (let i = 0; i < lastIndex && total > target; i++) {
    const m = messages[i];
    if (i !== latest && i !== howTo && m.role === 'tool' && m.content.length > 600 && m.content !== PLACEHOLDER && !(i > latest && latest >= 0 && isDiff(m))) {
      total -= tokensOf(m);
      messages[i] = { ...m, content: `${m.content.slice(0, 600)}\n[…trimmed]` };
      total += tokensOf(messages[i]);
    }
  }
  // Earlier turns of the chat (before this request): their gist is enough.
  // The user's request — not the runtime's own prompts after it (the double-check, “not finished yet”…).
  const request = messages.findLastIndex((m) => m.role === 'user' && !RUNTIME_PROMPT.test(m.content));
  for (let i = 1; i < request && total > target; i++) {
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
  const chain = (i: number) => i === latest || (latest >= 0 && i > latest && isRead(messages[i]) && isDiff(messages[i]));
  for (let i = request + 1; i < keepFrom && total > target; i++) {
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
  // No limit given: a cloud model, paid by the token, with every call carrying the whole conversation. Room for
  // the instructions, the latest page and the last steps; older page reads go once they don't fit.
  if (!contextTokens) return CLOUD_BUDGET;
  return Math.max(4_000, contextTokens - 1_500);
}

export function clipToolOutput(text: string): string {
  return text.length > MAX_TOOL_CHARS ? `${text.slice(0, MAX_TOOL_CHARS)}\n[…output truncated]` : text;
}
