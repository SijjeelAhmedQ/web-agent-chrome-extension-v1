import { describe, expect, it } from 'vitest';
import { askUserTool } from './runtime/askUser';
import type { ToolContext } from './tools/types';

const ctx = {} as ToolContext;

describe('ask_user', () => {
  it('waits for the answer and hands it to the model', async () => {
    const asked: string[] = [];
    const tool = askUserTool(async (q) => (asked.push(q), '021 555 0134'));
    const out = await tool.execute({ question: 'What is Hana’s phone number?' }, ctx);
    expect(asked).toEqual(['What is Hana’s phone number?']);
    expect(out.output).toContain('“021 555 0134”');
  });

  it('says not to guess when the user skips', async () => {
    const out = await askUserTool(async () => null).execute({ question: 'Which Brian — Dooley or Smith?', options: ['Brian Dooley', 'Brian Smith'] }, ctx);
    expect(out.output).toMatch(/didn’t answer.*Don’t guess/);
  });

  it('is not a way to ask for permission — the approval card does that', async () => {
    let asked = false;
    const out = await askUserTool(async () => ((asked = true), 'yes')).execute({ question: 'Shall I save the practice member now?' }, ctx);
    expect(asked).toBe(false);
    expect(out.output).toMatch(/approval/);
  });
});
