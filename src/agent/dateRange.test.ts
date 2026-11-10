import { describe, expect, it } from 'vitest';
import { sameDate } from '@/extension/content/actions';
import { BROWSER_TOOLS } from './tools/browserTools';
import { ElementMemory, type ToolContext } from './tools/types';

describe('a date field that took the date', () => {
  it('is the same date however it is written', () => {
    expect(sameDate('01/03/2026', '1/3/2026')).toBe(true);
    expect(sameDate('10/03/2026', '10/03/2026')).toBe(true);
    expect(sameDate('10/11/2025', '10/03/2026')).toBe(false); // put back as it was
    expect(sameDate('10/11/2025', '')).toBe(false);
    expect(sameDate('', '10/03/2026')).toBe(false);
  });
});

describe('type into a date field that put its old date back', () => {
  const ctxWith = (result: Record<string, unknown>) =>
    ({
      browser: {
        send: async (req: { kind: string }) => {
          if (req.kind === 'type') return result;
          if (req.kind === 'formAround') return null;
          if (req.kind === 'settle') return {};
          throw new Error(`unexpected ${req.kind}`);
        },
        currentTab: async () => ({ id: 1, url: 'https://inbox.test/', title: 'Smart AI Inbox' }),
      },
      settings: { realClicks: false },
      signal: new AbortController().signal,
      elements: new ElementMemory(),
      skills: [],
    }) as unknown as ToolContext;
  const type = BROWSER_TOOLS.find((t) => t.name === 'type')!;

  it('another format: says it did not take, and what the field shows', async () => {
    const out = await type.execute(
      { id: 9, text: '2026-03-10', clear: true },
      ctxWith({ element: { name: 'Date range', role: 'textbox' }, value: '10/11/2025', dateNotTaken: { box: 'From', refused: false } }),
    );
    expect(out.output).toMatch(/did not take “2026-03-10”: it put back “10\/11\/2025”/);
    expect(out.output).not.toMatch(/^Typed into/);
  });

  it('a disabled date: which box, not again, ask the user', async () => {
    const out = await type.execute(
      { id: 9, text: '01/01/2027', clear: true },
      ctxWith({ element: { name: 'Date range', role: 'textbox' }, value: '10/11/2026', dateNotTaken: { box: 'To', refused: true } }),
    );
    expect(out.output).toMatch(/“Date range” \(To\) refused “01\/01\/2027”: that date is disabled/);
    expect(out.output).toMatch(/Don't type it again and don't search with it: tell the user the To date “01\/01\/2027” can't be chosen, and ask for another/);
    expect(out.note).toBe("01/01/2027 can't be chosen — disabled");
  });

  it('the knowledge says which dates can be chosen', async () => {
    const restore = (await import('../../knowledge/web-agent-restore-indici.json')).default as { sites: { id: string; knowledge: { id: string; content: string }[] }[] };
    const search = restore.sites.find((s) => s.id === 'site-smart-inbox')!.knowledge.find((e) => e.id === 'kb_smart_2')!.content;
    expect(search).toMatch(/Only dates from one year back up to today can be chosen/);
  });

  it('a date that took is typed as usual', async () => {
    const out = await type.execute({ id: 9, text: '10/03/2026', clear: true }, ctxWith({ element: { name: 'Date range', role: 'textbox' }, value: '10/03/2026' }));
    expect(out.output).toMatch(/^Typed into “Date range”\. It now contains: “10\/03\/2026”/);
  });
});
