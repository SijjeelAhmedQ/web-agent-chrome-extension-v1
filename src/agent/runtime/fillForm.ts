import { z } from 'zod';
import type { ToolCall } from '../llm/types';
import type { AgentTool } from '../tools/types';

/**
 * fill_form: several fields of one form in one step. Each field is done by the runtime as its own type or
 * select_option step — with every check and approval those have — so a form of four fields is one model call,
 * not four. The runtime runs it (see AgentRun); this is what the model is told.
 */
export const FILL_FORM = 'fill_form';

const field = z
  .object({
    id: z.coerce.number().int().positive().describe('Field id from the latest read'),
    text: z.coerce.string().optional().describe('Text to type into it'),
    option: z.coerce.string().optional().describe('For a dropdown: the visible text of the option to choose'),
  })
  .refine((f) => (f.text === undefined) !== (f.option === undefined), { message: 'give text or option, not both' });

export const fillFormSchema = z.object({ fields: z.array(field).min(1).max(12).describe('The fields, in the order to fill them') });
export type FillFormArgs = z.infer<typeof fillFormSchema>;

export const fillFormTool: AgentTool<FillFormArgs> = {
  name: FILL_FORM,
  description:
    'Fill several fields of one form in one step, in order: text is typed into a field (as type does), option is chosen in a dropdown (as select_option does). Stops at a field that needs the user, or whose suggestions need a choice. It only fills — press Save yourself next.',
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
export const stopsFilling = (output: string): boolean => /^(Not |Error|Stopped|Cancelled)/.test(output) || /suggestions opened under it/.test(output);
