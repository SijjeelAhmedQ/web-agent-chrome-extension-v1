import { z } from 'zod';
import type { AgentTool, ToolContext } from '../tools/types';
import { asksToDo } from './saveOutcome';

/**
 * Asks the user for something only they know — a value the request left out — and waits: the task goes on with the
 * answer, the form it was filling still open. Never for permission: actions that change things are put to the user
 * by the approval card already, and asking first as well is asking twice.
 */
export type AskUser = (question: string, options: string[], ctx: ToolContext) => Promise<string | null>;

export function askUserTool(ask: AskUser): AgentTool<{ question: string; options?: string[] }> {
  return {
    name: 'ask_user',
    description:
      'Ask the user for information only they have, and wait for the answer — when the request leaves out a value you need (a required field, which of several records, a date). Never make such a value up. Not for permission: saving, sending or deleting is put to the user for approval by itself — just make that call.',
    schema: z.object({
      question: z.string().min(3).describe('One short question, e.g. "What is Hana’s phone number?"'),
      options: z.array(z.string().min(1)).max(6).optional().describe('The choices, when the answer is one of a few (the names of the matching records)'),
    }),
    risk: 'read',
    touchesPage: false,
    label: (a) => `Asking you: ${a.question}`,
    async execute(a, ctx) {
      const question = a.question.trim();
      if (asksToDo(question.endsWith('?') ? question : `${question}?`)) {
        return {
          output: 'Don’t ask for permission — the save, send or delete call itself puts it to the user for approval. Make that call now.',
          note: 'Not asked: the approval will ask',
        };
      }
      const answer = await ask(question, (a.options ?? []).map((o) => o.trim()).filter(Boolean), ctx);
      if (answer === null || !answer.trim()) {
        return {
          output: 'The user didn’t answer. Don’t guess the value: stop here and tell the user, in a line, what you need to go on.',
          note: 'No answer',
        };
      }
      return { output: `The user answered: “${answer.trim()}”. Go on with the task using it.`, note: `You said: ${answer.trim()}` };
    },
  };
}
