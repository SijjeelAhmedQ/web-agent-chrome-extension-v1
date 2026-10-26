import { describe, expect, it } from 'vitest';
import { BROWSER_TOOLS } from './tools/browserTools';
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
    expect(ask?.detail).toMatch(/saves itself/);
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
