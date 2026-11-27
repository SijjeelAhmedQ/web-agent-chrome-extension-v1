import { describe, expect, it } from 'vitest';
import type { ChatMessage } from './llm/types';
import { FIRST_PAGE, forTheWriter } from './runtime/context';
import { TASK_CONTEXT } from './planner/systemPrompt';

const knowledge = [
  TASK_CONTEXT,
  '',
  '### Navigation: How to reach Stations',
  'Address: /mentor-dashboard/layout. Click Stations in the side menu.',
  '### Workflow: Find a practice member by name',
  'Open Practice members, type the name in the search box.',
  '### Rule: How to answer about stations',
  'Give the count per wing.',
  '',
  '## Where you are',
  '- Current tab: “Stations”',
].join('\n');

const page = `Page: Stations\n${'[12] button “Free” '.repeat(200)}`;

describe('the writer of an analysis gets what was read, not how the site is worked', () => {
  const messages: ChatMessage[] = [
    { role: 'system', content: 'rules' },
    { role: 'user', content: knowledge },
    { role: 'user', content: 'how many stations in Steiner Wing' },
    { role: 'user', content: `${FIRST_PAGE}\n${page}` },
    { role: 'assistant', content: '', toolCalls: [{ id: '1', name: 'read_table', arguments: {} }] },
    { role: 'tool', toolCallId: '1', toolName: 'read_table', content: 'Wing: Steiner Wing 19, Dobson Wing 19' },
  ];

  it('keeps of the knowledge only what it says about answers', () => {
    const context = forTheWriter(messages, TASK_CONTEXT)[1].content;
    expect(context).toContain('How to answer about stations');
    expect(context).not.toContain('How to reach Stations');
    expect(context).not.toContain('Find a practice member');
  });

  it('with a table read, the page reads go and the data stays whole', () => {
    const out = forTheWriter(messages, TASK_CONTEXT);
    expect(out[3].content.length).toBeLessThan(300);
    expect(out[5].content).toBe('Wing: Steiner Wing 19, Dobson Wing 19');
    expect(out[2].content).toBe('how many stations in Steiner Wing');
  });

  it('with no table or records read, the page is the data: it stays', () => {
    const out = forTheWriter(messages.slice(0, 4), TASK_CONTEXT);
    expect(out[3].content).toContain('[12] button “Free”');
  });
});
