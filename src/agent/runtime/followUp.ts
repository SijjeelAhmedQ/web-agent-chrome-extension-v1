import type { StepRecord } from '@/shared/types/history';
import type { ChatMessage } from '../llm/types';

/**
 * A task that ends by asking the user something (“What reason should I add?”) is not over: the
 * user's next message is the answer, and the agent must carry on from where it stopped — not
 * start the task again. The answer kept in memory therefore lists the steps already done.
 */

const STOPPED = '[Where I stopped — steps already done in this task:';

/** Polite offers at the end of an answer are not questions the task is waiting on. */
const OFFER = /\b(anything else|something else|let me know|else (can|could|should) i|help (you )?with|would you like me to|shall i|want me to|need (any|more|further))\b[^?]*\?/gi;

/** True when an answer ends by asking the user something the task needs. */
export function asksUser(answer: string): boolean {
  return /\?/.test(answer.trim().slice(-500).replace(OFFER, ''));
}

/** The answer as remembered for the next turn: when it asks the user something, with the steps done so far. */
export function rememberedAnswer(answer: string, steps: StepRecord[]): string {
  if (!asksUser(answer)) return answer;
  const done = steps.filter((s) => s.status === 'done' && s.tool !== 'verify').slice(-15);
  if (!done.length) return answer;
  const lines = done.map((s, i) => `${i + 1}. ${s.label}${s.note ? ` → ${s.note}` : ''}`);
  return `${answer}\n\n${STOPPED}\n${lines.join('\n')}]`;
}

export interface FollowUp {
  /** What the model is sent in place of the bare reply. */
  request: string;
  /** The earlier request this reply belongs to (for picking site knowledge). */
  task: string;
  /** Labels of the page actions already done before the question. */
  doneSteps: string[];
}

/** When the last answer asked the user something, the new message is their reply: frame it as one. */
export function followUpOf(history: ChatMessage[], reply: string): FollowUp | null {
  const last = history.at(-1);
  const asked = history.at(-2);
  if (!last || last.role !== 'assistant' || asked?.role !== 'user') return null;
  // The list of steps is what closes the answer — not the same words quoted inside it.
  const at = last.content.lastIndexOf(STOPPED);
  if (at < 0 || !last.content.trimEnd().endsWith(']')) return null;
  const task = asked.content.trim();
  const doneSteps = last.content
    .slice(at + STOPPED.length)
    .split('\n')
    .map((l) => l.match(/^\d+\. (.*?)(?: → .*)?\]?$/)?.[1]?.trim() ?? '')
    .filter(Boolean);
  const request = [
    `My reply to your question: “${reply.trim()}”`,
    '',
    `Carry on with the task I gave you before (“${task}”) from where you stopped. The browser is as you left it, and the steps listed at the end of your last answer are already done — don't do them again and don't start the task over. Read the page, use my reply where it was needed, do only the steps that are left, then answer. (If my message is a new request rather than a reply, do it as a new task.)`,
  ].join('\n');
  return { request, task, doneSteps };
}

/** Earlier turns as the model sees them: old answers flagged as possibly out of date — except the question being answered now. */
export function historyForModel(history: ChatMessage[], followUp: FollowUp | null): ChatMessage[] {
  return history.map((m, i): ChatMessage => {
    if (m.role !== 'assistant') return m;
    const current = followUp && i === history.length - 1;
    return { ...m, content: `${current ? '(Your last answer — you stopped here to ask the user)' : '(Earlier answer — may be out of date)'}\n${m.content}` };
  });
}
