import { describe, expect, it } from 'vitest';
import { SITE_TEMPLATES } from '@/shared/constants/templates';
import type { KnowledgeEntry } from '@/shared/types/config';
import { knowledgeAsText, mergeKnowledge, parseKnowledgeText } from './planner/knowledgeText';
import { knowledgeSection } from './planner/siteKnowledge';

const indici = () => SITE_TEMPLATES.find((t) => t.key === 'indici')!.make();
let n = 0;
const id = () => `new${++n}`;

describe('knowledge as text', () => {
  it('round-trips: text → entries → the same text', () => {
    const site = { ...indici(), neverClick: ['Pharmac'] };
    site.knowledge[1].enabled = false;
    const text = knowledgeAsText(site);
    expect(text).toMatch(/^### Rule: Buttons you never click here/);
    expect(text).toMatch(/### Page \(off\): Patient Search page/);
    const parsed = parseKnowledgeText(text);
    expect(parsed.neverClick).toEqual(['Pharmac']);
    expect(parsed.entries).toHaveLength(site.knowledge.length);
    const workflow = parsed.entries.find((e) => e.kind === 'workflow')!;
    expect(workflow.trigger).toBe('Goto Patients and select Search & List and select Arya Stark');
    expect(workflow.content).toMatch(/^1\. open_menu/);
    expect(parsed.entries.find((e) => e.kind === 'page')!.enabled).toBe(false);
    expect(knowledgeAsText({ knowledge: mergeKnowledge(site.knowledge, parsed.entries, true, id).knowledge, neverClick: parsed.neverClick! })).toBe(text);
  });

  it('reads text copied from the preview (header and footer lines ignored)', () => {
    const preview = knowledgeSection([indici()], 'select arya stark').text + '\n\nMore knowledge for this site (call site_knowledge with a topic to read one): “X”.';
    const parsed = parseKnowledgeText(preview);
    expect(parsed.entries.map((e) => e.kind).sort()).toEqual(['navigation', 'page', 'rule', 'workflow']);
    expect(parsed.entries.every((e) => !/What the user has taught|More knowledge/.test(e.content))).toBe(true);
  });

  it('understands hand-written blocks, “Page & controls” and unknown kinds', () => {
    const parsed = parseKnowledgeText(
      [
        'Some notes before the first heading are ignored.',
        '### rule: Never open Search Vault',
        'Use Search.',
        '',
        '### Page & controls: Medication form',
        '- Take: number',
        '### Workflow: Add a medication',
        'For requests like: "add medication X take 2"',
        '1. Click Medications',
        '### Tip: something',
        'ignored',
      ].join('\n'),
    );
    expect(parsed.entries.map((e) => [e.kind, e.title])).toEqual([
      ['rule', 'Never open Search Vault'],
      ['page', 'Medication form'],
      ['workflow', 'Add a medication'],
    ]);
    expect(parsed.entries[2]).toMatchObject({ trigger: 'add medication X take 2', content: '1. Click Medications' });
    expect(parsed.unknown).toEqual(['### Tip: something']);
    expect(parsed.neverClick).toBeNull();
  });

  it('merges: same kind + title updates in place, new ones are added, the rest kept or removed', () => {
    const existing: KnowledgeEntry[] = indici().knowledge;
    const parsed = parseKnowledgeText('### Rule: Open a patient by clicking the name — never an icon\nNew text.\n\n### Rule: Brand new\nHello.');
    const keep = mergeKnowledge(existing, parsed.entries, false, id);
    expect(keep).toMatchObject({ added: 1, updated: 1, removed: 0, missing: 3 });
    expect(keep.knowledge).toHaveLength(5);
    const rule = keep.knowledge.find((k) => k.title.startsWith('Open a patient'))!;
    expect(rule.id).toBe(existing.find((k) => k.title.startsWith('Open a patient'))!.id);
    expect(rule.content).toBe('New text.');
    const replace = mergeKnowledge(existing, parsed.entries, true, id);
    expect(replace).toMatchObject({ added: 1, updated: 1, removed: 3 });
    expect(replace.knowledge).toHaveLength(2);
  });
});
