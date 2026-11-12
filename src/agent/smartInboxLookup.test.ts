import { describe, expect, it } from 'vitest';
import restore from '../../knowledge/web-agent-restore-indici.json';
import { searchKnowledge } from './planner/siteKnowledge';
import type { SiteProfile } from '@/shared/types/config';

// The Smart AI Inbox's own knowledge, looked up the way the model asked for it in the live runs of 2026-11-12.
const inbox = (restore.sites as unknown as SiteProfile[]).filter((s) => /smart inbox/i.test(s.name));
const best = (topic: string) => searchKnowledge(inbox, topic)[0]?.id;

describe('looking up the Smart AI Inbox knowledge finds the workflow asked about', () => {
  it.each([
    ["Show all of a patient's records, filed ones too", 'kb_smart_3'],
    ['Inbox scope for a patient — Show all filed for patient', 'kb_smart_3'],
    ['sort patients by name', 'kb_smart_2'],
    ['who is this record assigned to', 'kb_smart_attention'],
    ['what saved searches are there', 'kb_smart_11'],
    ['pin a patient', 'kb_smart_pin'],
    ['which practice and location', 'kb_smart_topbar'],
  ])('“%s” → %s', (topic, id) => expect(best(topic)).toBe(id));
});

describe('an entry already in the instructions, looked up again', () => {
  it('is pointed at once, then given in full', async () => {
    const { knowledgeTool } = await import('./tools/knowledgeTool');
    const { formatEntry } = await import('./planner/siteKnowledge');
    // Every entry the look-up finds is in the prompt already, as in the live run.
    const prompt = searchKnowledge(inbox, 'File and unfile records').map(formatEntry).join(' ');
    const tool = knowledgeTool(inbox);
    const ctx = { knowledgeInPrompt: () => prompt } as never;
    const first = await tool.execute({ topic: 'File and unfile records' }, ctx);
    expect(first.output).toMatch(/already in your instructions/);
    const again = await tool.execute({ topic: 'File and unfile records' }, ctx);
    expect(again.output).toContain('Show all filed for this patient');
  });
});
