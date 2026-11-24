import { z } from 'zod';
import type { ToolCall } from '../llm/types';
import type { AgentTool } from '../tools/types';
import type { ElementInfo } from '@/shared/types/page';

/**
 * fill_form: several fields of one form in one step. Each field is done by the runtime as its own type or
 * select_option step — with every check and approval those have — so a form of four fields is one model call,
 * not four. The runtime runs it (see AgentRun); this is what the model is told.
 */
export const FILL_FORM = 'fill_form';

const field = z
  .object({
    id: z.coerce.number().int().positive().describe('Field id'),
    text: z.coerce.string().optional().describe('Text to type'),
    option: z.coerce.string().optional().describe('A dropdown\'s option'),
  })
  .refine((f) => (f.text === undefined) !== (f.option === undefined), { message: 'give text or option, not both' });

export const fillFormSchema = z.object({ fields: z.array(field).min(1).max(12).describe('The fields, in order') });
export type FillFormArgs = z.infer<typeof fillFormSchema>;

export const fillFormTool: AgentTool<FillFormArgs> = {
  name: FILL_FORM,
  description:
    'Fill several fields of one form in one step, in order: text is typed, option chosen in a dropdown. Stops at a field that needs the user. Only fills — press Save or Search next.',
  schema: fillFormSchema,
  risk: 'action',
  touchesPage: true,
  label: (a) => `Filling ${a.fields.length} field${a.fields.length === 1 ? '' : 's'}`,
  async execute() {
    return { output: 'Error: fill_form is run by the agent itself.' };
  },
};

/** One field's own step: the type or select_option call fill_form stands for. */
export const fieldCall = (f: FillFormArgs['fields'][number], n: number, parent: string): ToolCall =>
  f.option !== undefined
    ? { id: `${parent}_${n}`, name: 'select_option', arguments: { id: f.id, option: f.option } }
    : { id: `${parent}_${n}`, name: 'type', arguments: { id: f.id, text: f.text ?? '' } };

/** A field's result that ends the filling: it was refused, failed, needs the user, or waits for a suggestion to be chosen. */
const GO_ON = /^(search|save|submit|apply|find|go|ok|create|done|confirm|continue|next)\b/i;

/**
 * The buttons that go on from the fields just filled (Search, Save…): those of the latest page read that come
 * right after the fields in the page, by id (ids follow the page's order). At most two.
 */
export function goOnButtons(onPage: Pick<ElementInfo, 'id' | 'name' | 'role'>[], fieldIds: number[]): { id: number; name: string }[] {
  if (!fieldIds.length) return [];
  const first = Math.min(...fieldIds);
  const last = Math.max(...fieldIds);
  return onPage
    .filter((e) => e.role === 'button' && e.id > first && e.id <= last + 15 && !fieldIds.includes(e.id) && GO_ON.test(e.name.trim()))
    .sort((a, b) => a.id - b.id) // an overview lists by importance, not page order
    .slice(0, 2)
    .map((e) => ({ id: e.id, name: e.name.trim() }));
}

export const stopsFilling =(output: string): boolean => /^(Not |Error|Stopped|Cancelled)/.test(output) || /suggestions opened under it/.test(output);
