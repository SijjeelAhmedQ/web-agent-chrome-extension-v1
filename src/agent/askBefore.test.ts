import { describe, expect, it } from 'vitest';
import { BROWSER_TOOLS, formAfterLoading, tabPatience } from './tools/browserTools';
import { ElementMemory, type ToolContext } from './tools/types';

// A site's “ask before” controls change a record as soon as they are used — clicked, or typed into.
describe('ask-before controls', () => {
  const ctxFor = (name: string, role: string, tag: string) =>
    ({
      browser: {
        send: async (req: { kind: string }) => {
          if (req.kind === 'describe') return { name, role, tag, formHasPassword: false, formHasPayment: false, formIsSearch: false, formSubmitLabels: [] };
          throw new Error(`unexpected ${req.kind}`);
        },
        currentTab: async () => ({ url: 'https://inbox-app-dev.vitonta.com/dashboardv2' }),
      },
      settings: {},
      signal: new AbortController().signal,
      elements: new ElementMemory(),
      skills: [],
      askBefore: ['Confidential', 'Diagnostic Comment'],
    }) as unknown as ToolContext;

  it('asks before typing into a box that saves itself, and shows the text', async () => {
    const type = BROWSER_TOOLS.find((t) => t.name === 'type')!;
    const ask = await type.assess!({ id: 3, text: '[web agent test] comment', clear: true, submit: false }, ctxFor('Diagnostic Comment', 'textbox', 'textarea'));
    expect(ask?.title).toBe('Type “[web agent test] comment” into “Diagnostic Comment”?');
    expect(ask?.detail).toMatch(/as you type/);
  });

  it('does not add words a field already holds (a comment added on the record before)', async () => {
    const type = BROWSER_TOOLS.find((t) => t.name === 'type')!;
    const sent: string[] = [];
    const ctx = {
      browser: {
        send: async (req: { kind: string }) => {
          sent.push(req.kind);
          if (req.kind === 'fieldText') return { value: 'Attention provider testing hello world' };
          throw new Error(`unexpected ${req.kind}`);
        },
      },
      settings: {},
      elements: new ElementMemory(),
      askBefore: ['Diagnostic Comment'],
    } as unknown as ToolContext;
    const args = { id: 3, text: ' Hello World', clear: false, submit: false };
    expect(await type.assess!(args, ctx)).toBeNull();
    expect((await type.execute(args, ctx)).output).toMatch(/^Not typed: .* already holds “Hello World”/);
    expect(sent).not.toContain('type');
  });

  it('never asks about an id that is another element than the one named, and does not click it', async () => {
    const click = BROWSER_TOOLS.find((t) => t.name === 'click')!;
    const sent: string[] = [];
    const ctx = {
      browser: { send: async (req: { kind: string }) => (sent.push(req.kind), { name: 'Send Text', role: 'button', tag: 'button', formHasPassword: false, formHasPayment: false, formIsSearch: false, formSubmitLabels: [] }) },
      settings: {},
      elements: new ElementMemory(),
      askBefore: [],
    } as unknown as ToolContext;
    ctx.elements.remember([{ id: 3403, role: 'button', name: 'Send Text', tag: 'button' } as never]);
    const args = { id: 3403, name: 'Medications', double: false };
    expect(await click.assess!(args, ctx)).toBeNull();
    expect((await click.execute(args, ctx)).output).toMatch(/^Not clicked: \[3403\] is button “Send Text”/);
    expect(sent).not.toContain('click');
  });

  it('keeps the list when the configuration is loaded', async () => {
    const { normalizeSite } = await import('@/shared/storage/configStore');
    expect(normalizeSite({ name: 'inbox', askBefore: ['Diagnostic Comment'] }).askBefore).toEqual(['Diagnostic Comment']);
  });

  it('asks before clicking a tick box that saves itself; other fields are not asked about', async () => {
    const click = BROWSER_TOOLS.find((t) => t.name === 'click')!;
    expect((await click.assess!({ id: 4, name: '', double: false }, ctxFor('Confidential', 'checkbox', 'input')))?.detail).toMatch(/change the record right away/);
    const type = BROWSER_TOOLS.find((t) => t.name === 'type')!;
    expect(await type.assess!({ id: 5, text: 'Arya', clear: true, submit: false }, ctxFor('Patient Name', 'textbox', 'input'))).toBeNull();
  });
});

// Pop-ups the site leaves to the user (an NZF interaction): their buttons are the user's answer.
describe('pop-ups the user answers', () => {
  const ctxFor = (name: string, dialogText: string | undefined, userSaid: string) =>
    ({
      browser: {
        send: async (req: { kind: string }) => {
          if (req.kind === 'describe') return { name, role: 'button', tag: 'button', dialogText, formHasPassword: false, formHasPayment: false, formIsSearch: false, formSubmitLabels: [] };
          throw new Error(`unexpected ${req.kind}`);
        },
        currentTab: async () => ({ url: 'https://pmstraining.vitonta.com/Home/accordionslider' }),
      },
      settings: {},
      signal: new AbortController().signal,
      elements: new ElementMemory(),
      skills: [],
      askBefore: [],
      askPopups: ['New Zealand Formulary', 'Overwrite All Existing'],
      userSaid,
    }) as unknown as ToolContext;
  const click = BROWSER_TOOLS.find((t) => t.name === 'click')!;
  const nzf = 'NZF New Zealand Formulary KEY . avoid . adjust Interactions: Panadol … OK Cancel';

  it('asks before pressing one of their buttons', async () => {
    const ask = await click.assess!({ id: 8015, name: 'OK', double: false }, ctxFor('OK', nzf, 'yes, add a new one anyway'));
    expect(ask?.detail).toMatch(/leaves to you/);
  });

  it('presses the button the user named in this message', async () => {
    expect(await click.assess!({ id: 8015, name: 'OK', double: false }, ctxFor('OK', nzf, 'OK'))).toBeNull();
  });

  it('leaves other pop-ups and the page alone', async () => {
    // Medication Advanced Search has an “NZF Details” column: not the NZF pop-up.
    expect(await click.assess!({ id: 7978, name: 'Panadol', double: false }, ctxFor('Panadol', 'Medication Advanced Search Find Medicine NZF Details Panadol', 'add panadol'))).toBeNull();
    expect(await click.assess!({ id: 7560, name: 'Medications', double: false }, ctxFor('Medications', undefined, 'add panadol'))).toBeNull();
  });
});

// A menu item's form can come after a pop-up that only says it is loading (the Smart AI Inbox's Create Task).
describe('the form a menu item opens', () => {
  it('is waited for past a “Loading …” pop-up', async () => {
    const shown = ['Loading Task Data', 'Loading Task Data', 'Loading Task Data', 'Add Task'];
    let asked = 0;
    const ctx = {
      browser: { send: async (req: { kind: string }) => (req.kind === 'dialogs' ? { dialogs: [{ title: shown[Math.min(asked++, shown.length - 1)] }] } : null) },
    } as unknown as ToolContext;
    await formAfterLoading(ctx);
    expect(asked).toBe(4);
  });
});

// “Open AI Assisted Inbox” shows its tooltip, and its tab comes up to eleven seconds later.
describe('the tab an “Open …” control opens', () => {
  it('is waited for longer when only its own tooltip showed', () => {
    expect(tabPatience('Open AI Assisted Inbox', ['Open AI Assisted Inbox'])).toBe(12_000);
  });
  it('is not when anything else changed, or for other controls', () => {
    expect(tabPatience('Open result: CBC', ['Haemoglobin 96'])).toBe(2_500);
    expect(tabPatience('Save', ['Save'])).toBe(2_500);
    expect(tabPatience('Open AI actions', [])).toBe(2_500);
  });
});
