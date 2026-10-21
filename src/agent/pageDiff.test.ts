import { describe, expect, it } from 'vitest';
import type { ElementInfo, PageSnapshot } from '@/shared/types/page';
import type { ChatMessage } from './llm/types';
import { compactMessages } from './runtime/context';
import { DIFF_HEAD, memoOf, pageDiff } from './tools/pageDiff';

const el = (id: number, name: string, extra: Partial<ElementInfo> = {}): ElementInfo => ({ id, role: 'button', name, tag: 'button', inViewport: true, ...extra });
const snap = (elements: ElementInfo[], extra: Partial<PageSnapshot> = {}): PageSnapshot => ({
  docId: 'doc1',
  url: 'https://pms.test/consult',
  title: 'Consult Detail',
  scroll: { percent: 0, screens: 1, atTop: true, atBottom: true },
  elements,
  omitted: 0,
  headings: [],
  text: 'Arya STARK\nConsult 1',
  textTruncated: false,
  frames: [],
  dialogOpen: false,
  ...extra,
});

const page = Array.from({ length: 300 }, (_, i) => el(5000 + i, `Control ${i}`));

describe('reading the same page again gives only what changed', () => {
  it('lists new, changed and gone elements and new text — not the rest', () => {
    const before = snap([el(1, '×'), ...page, el(2, 'Take', { role: 'textbox', value: '' })]);
    const after = snap([...page, el(2, 'Take', { role: 'textbox', value: '2' }), el(3, 'Save')], { text: 'Arya STARK\nConsult 1\nGabapentin 100 mg capsule' });
    const diff = pageDiff(memoOf(before)!, after)!;
    expect(diff.startsWith(DIFF_HEAD)).toBe(true);
    expect(diff).toContain('New on the page (1):\n[3] button "Save"');
    expect(diff).toContain('Changed (as they are now) (1):\n[2] textbox "Take" value="2"');
    expect(diff).toContain('Gone from the page (1): [1] “×”');
    expect(diff).toContain('New text on the page:\nGabapentin 100 mg capsule');
    expect(diff).not.toContain('Control 7');
  });

  it('says so when nothing changed — scrolling (elements going off screen) is not a change', () => {
    const before = snap(page);
    const after = snap(page.map((e, i) => (i > 100 ? { ...e, inViewport: false } : e)), { scroll: { percent: 40, screens: 3, atTop: false, atBottom: false } });
    const diff = pageDiff(memoOf(before)!, after)!;
    expect(diff).toContain('Nothing else changed since your last read.');
    expect(diff).toContain('Scroll: scrolled 40% of 3 screens');
  });

  it('gives the whole page when more is new than it would list (a tab or panel opened)', () => {
    const before = snap(page.slice(0, 50));
    const after = snap([...page.slice(0, 50), ...Array.from({ length: 120 }, (_, i) => el(9000 + i, `Inbox control ${i}`))]);
    expect(pageDiff(memoOf(before)!, after)).toBeNull();
  });

  it('does not call a control gone that is only left out of the listing', () => {
    const before = snap(page.slice(0, 50));
    const after = snap([...page.slice(10, 50), el(3, 'Save')], { unlisted: page.slice(0, 10).map((e) => e.id) });
    const diff = pageDiff(memoOf(before)!, after)!;
    expect(diff).not.toContain('Gone from the page');
    expect(diff).toContain('[3] button "Save"');
  });

  it('gives the whole page for another document or address', () => {
    const memo = memoOf(snap(page))!;
    expect(pageDiff(memo, snap(page, { docId: 'doc2' }))).toBeNull();
    expect(pageDiff(memo, snap(page, { url: 'https://pms.test/other' }))).toBeNull();
  });

  it('keeps the full read a chain of changes stands on when the conversation is shortened', () => {
    const full = `Page: Consult Detail\n${'[5000] button "Control" '.repeat(400)}`;
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'rules' },
      { role: 'user', content: 'add medication' },
      { role: 'tool', toolName: 'read_page', toolCallId: '0', content: `Page: Search\n${'[4000] link "Old" '.repeat(400)}` },
      { role: 'tool', toolName: 'read_page', toolCallId: '1', content: full },
      { role: 'tool', toolName: 'read_page', toolCallId: '2', content: `${DIFF_HEAD} — …\nGone from the page (1): [1] “×”` },
      { role: 'tool', toolName: 'read_page', toolCallId: '3', content: `${DIFF_HEAD} — …\nNothing else changed since your last read.` },
    ];
    compactMessages(msgs, 3_500);
    expect(msgs[2].content).toMatch(/removed/);
    expect(msgs[3].content.startsWith('Page: Consult Detail')).toBe(true);
    expect(msgs[4].content).toContain('Gone from the page');
    expect(msgs[5].content).toContain('Nothing else changed');
  });
});

describe('the records read in one go', () => {
  it('says once what every record repeats, and fits all of them', async () => {
    const { recordsOutput } = await import('./tools/browserTools');
    const banner = 'Name: Arya STARK\nNHI Number: ZAA3490\nDOB: 03/12/2015\nLast RX: 21/10/2026';
    const records = Array.from({ length: 16 }, (_, i) => `${banner}\nFields — Subject: Result ${i}; Result Date: 0${i % 9}/10/2026\n${'Lab line text\n'.repeat(120)}ALT ${i} ${i % 3 ? 'Normal' : 'Abnormal'}`);
    const out = recordsOutput(records, 'Next', 'Cancel', 18_000);
    expect(out.length).toBeLessThanOrEqual(20_000);
    expect(out.match(/Name: Arya STARK/g)).toHaveLength(1);
    expect(out).toContain('The same on every record:');
    expect(out).toContain('### Record 16');
    expect(out).toContain('These are all 16 records of the list');
    // Every record's result flag survives the cut, even at its end.
    expect(out.match(/Abnormal/g)?.length).toBe(6);
  });
});

describe('a long task on a small context', () => {
  it('stays within the budget and keeps the user’s request, however many short steps', () => {
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'rules '.repeat(400) },
      { role: 'user', content: 'add a recall for Arya: provider Training DOCTOR' },
    ];
    for (let i = 0; i < 40; i++) {
      msgs.push({ role: 'assistant', content: 'Next I will set the field. '.repeat(4), toolCalls: [{ id: `c${i}`, name: 'type', arguments: { id: 9000 + i, text: 'Training DOCTOR provider search text' } }] });
      msgs.push({ role: 'tool', toolName: 'type', toolCallId: `c${i}`, content: `Typed into “Field ${i}”. It now contains: “value ${i}”. `.repeat(6) });
    }
    compactMessages(msgs, 3_000);
    const total = msgs.reduce((n, m) => n + Math.ceil(m.content.length / 3.2) + (m.role === 'assistant' && m.toolCalls ? Math.ceil(JSON.stringify(m.toolCalls).length / 3.2) : 0), 0);
    expect(total).toBeLessThan(3_600);
    expect(msgs[1].content).toContain('add a recall for Arya');
    expect(msgs.at(-1)!.content).toContain('Field 39');
  });
});

describe('a long task after one whole page read', () => {
  it('drops older results after the read too — the request and the read stay', () => {
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'rules '.repeat(400) },
      { role: 'user', content: 'list all of Arya’s recalls' },
      { role: 'tool', toolName: 'read_page', toolCallId: 'r', content: `Page: Consult Detail\n${'[5000] button "Control" '.repeat(120)}` },
    ];
    for (let i = 0; i < 40; i++) {
      msgs.push({ role: 'assistant', content: '', toolCalls: [{ id: `k${i}`, name: 'site_knowledge', arguments: { topic: 'Recall list' } }] });
      msgs.push({ role: 'tool', toolName: 'site_knowledge', toolCallId: `k${i}`, content: `### Page: Recall list\n${'- a row of the knowledge text '.repeat(40)}` });
    }
    compactMessages(msgs, 4_000);
    const total = msgs.reduce((n, m) => n + Math.ceil(m.content.length / 3.2) + (m.role === 'assistant' && m.toolCalls ? Math.ceil(JSON.stringify(m.toolCalls).length / 3.2) : 0), 0);
    expect(total).toBeLessThan(4_800);
    expect(msgs[1].content).toContain('list all of Arya');
    expect(msgs[2].content.startsWith('Page: Consult Detail')).toBe(true);
  });
});
