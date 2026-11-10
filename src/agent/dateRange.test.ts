import { describe, expect, it } from 'vitest';
import { dateOrder, isoOf, sameDate } from '@/extension/content/actions';
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

describe('a typed date, read in the order the field writes its dates', () => {
  // Ant's range calendar marks the range's days (cells titled YYYY-MM-DD).
  const calendar = (marked: string) => {
    document.body.innerHTML = `<div class="ant-picker-dropdown"><table><tr>
      <td title="${marked}" class="ant-picker-cell ant-picker-cell-in-view ant-picker-cell-range-start"></td>
    </tr></table></div>`;
    return document.querySelector('.ant-picker-dropdown')!;
  };

  it('10/11/2025 shown, 10 November marked: day first — 01/10/2026 is 1 October, not 10 January', () => {
    const order = dateOrder(calendar('2025-11-10'), '10/11/2025');
    expect(order).toBe('dmy');
    expect(isoOf('01/10/2026', order)).toBe('2026-10-01');
  });

  it('month first, when the field writes them so', () => {
    const order = dateOrder(calendar('2025-10-11'), '10/11/2025');
    expect(order).toBe('mdy');
    expect(isoOf('01/10/2026', order)).toBe('2026-01-10');
  });

  it('a day over 12 tells; unknown, day first', () => {
    expect(dateOrder(calendar('2026-01-01'), '25/11/2025')).toBe('dmy');
    expect(isoOf('01/10/2026', null)).toBe('2026-10-01');
    expect(isoOf('2026-10-01', null)).toBe('2026-10-01');
  });

  it('not a date: nothing to pick (then it is typed)', () => {
    expect(isoOf('13/13/2026', 'dmy')).toBeNull();
    expect(isoOf('today', 'dmy')).toBeNull();
  });
});

describe('type into a date field that did not take the date', () => {
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
  const box = { name: 'Date range', role: 'textbox' };

  it('another format: type it the way the field writes dates', async () => {
    const out = await type.execute({ id: 9, text: '2026-03-10', clear: true }, ctxWith({ element: box, value: '10/11/2025', dateNotTaken: { box: 'From', why: 'format' } }));
    expect(out.output).toMatch(/did not take “2026-03-10”: it put back “10\/11\/2025”\. Type the date the way that one is written/);
    expect(out.output).not.toMatch(/^Typed into/);
  });

  it('disabled: which box, not again, ask the user — and no range guessed from the date put back', async () => {
    const out = await type.execute({ id: 9, text: '01/01/2027', clear: true }, ctxWith({ element: box, value: '10/11/2026', dateNotTaken: { box: 'To', why: 'disabled' } }));
    expect(out.output).toMatch(/“Date range” \(To\) refused “01\/01\/2027”: that date is disabled there\./);
    expect(out.output).toMatch(/tell the user the To date “01\/01\/2027” can't be chosen — don't guess which dates it allows, and ask for another/);
    expect(out.output).not.toMatch(/put back/);
    expect(out.note).toBe("01/01/2027 can't be chosen — disabled");
  });

  it('not taken, put back: not called disabled', async () => {
    const out = await type.execute(
      { id: 9, text: '01/10/2026', clear: true },
      ctxWith({ element: box, value: '10/11/2025', dateNotTaken: { box: 'From', why: 'unknown', before: '10/11/2025' } }),
    );
    expect(out.output).toMatch(/did not take “01\/10\/2026” — it put back “10\/11\/2025”\. Try once more/);
    expect(out.output).not.toMatch(/disabled/);
  });

  it('another date than asked: said, and no search with it', async () => {
    const out = await type.execute(
      { id: 9, text: '01/10/2026', clear: true },
      ctxWith({ element: box, value: '10/01/2026', dateNotTaken: { box: 'From', why: 'unknown', before: '10/11/2025' } }),
    );
    expect(out.output).toMatch(/it now holds “10\/01\/2026” — another date\. Don't search with it/);
  });

  it('a field that says its limits: they go to the user', async () => {
    const out = await type.execute(
      { id: 9, text: '2027-01-01', clear: true },
      ctxWith({ element: { name: 'To', role: 'textbox' }, value: '2027-01-01', dateNotTaken: { box: '', why: 'disabled', allowed: 'from 2025-11-10 up to 2026-11-10' } }),
    );
    expect(out.output).toMatch(/can't be chosen \(it allows from 2025-11-10 up to 2026-11-10\)/);
  });

  it('a date that took is typed as usual', async () => {
    const out = await type.execute({ id: 9, text: '10/03/2026', clear: true }, ctxWith({ element: box, value: '10/03/2026' }));
    expect(out.output).toMatch(/^Typed into “Date range”\. It now contains: “10\/03\/2026”/);
  });

  it('the knowledge names no fixed range: which dates are disabled can change', async () => {
    const restore = (await import('../../knowledge/web-agent-restore-indici.json')).default as { sites: { id: string; knowledge: { id: string; content: string }[] }[] };
    const search = restore.sites.find((s) => s.id === 'site-smart-inbox')!.knowledge.find((e) => e.id === 'kb_smart_2')!.content;
    expect(search).toMatch(/Some dates may be disabled — which ones can change/);
    expect(search).not.toMatch(/one year back up to today/);
  });
});
