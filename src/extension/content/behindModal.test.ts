import { describe, expect, it } from 'vitest';
import { resolveToAct } from './actions';
import { idFor } from './elements';
import { behindModal, modalInFront } from './snapshot';

// OctansCare's list page with its “New practice member” drawer open: a Provider filter behind it, a Provider in it,
// and the drawer's Provider list rendered at the end of the page (outside the drawer).
const PAGE = `
  <main><input aria-label="Provider" placeholder="Any provider"><button>Add practice member</button></main>
  <section role="dialog" aria-modal="true" aria-labelledby="t"><h2 id="t">New practice member</h2>
    <button id="providerId" aria-haspopup="listbox">Choose a provider</button><button>Save</button></section>
  <div class="mantine-Combobox-dropdown"><div role="option">Brian Dooley</div></div>`;

const shown = () => {
  // jsdom lays nothing out: the pop-up is what is on top.
  document.elementFromPoint = () => document.querySelector('[role=dialog]');
  for (const e of Array.from(document.querySelectorAll('*'))) {
    (e as HTMLElement).getBoundingClientRect = () => ({ width: 40, height: 20, top: 0, left: 0, right: 40, bottom: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    (e as HTMLElement & { checkVisibility: () => boolean }).checkVisibility = () => true;
  }
};

describe('a modal pop-up in front', () => {
  it('makes the page behind it out of reach — not its own controls, nor its lists drawn outside it', () => {
    document.body.innerHTML = PAGE;
    shown();
    const modal = modalInFront();
    expect(modal?.getAttribute('aria-labelledby')).toBe('t');
    expect(behindModal(document.querySelector('main input')!, modal)).toBe(true);
    expect(behindModal(document.querySelector('#providerId')!, modal)).toBe(false);
    expect(behindModal(document.querySelector('[role=option]')!, modal)).toBe(false);
  });

  it('refuses an action on the page behind it, saying why and what to do', () => {
    document.body.innerHTML = PAGE;
    shown();
    const filter = idFor(document.querySelector('main input')!);
    expect(() => resolveToAct(filter)).toThrow(/“Provider” is on the page behind the open pop-up “New practice member”/);
    expect(resolveToAct(idFor(document.querySelector('#providerId')!))).toBe(document.querySelector('#providerId'));
  });

  it('none open, or one that is not modal: everything is in reach', () => {
    document.body.innerHTML = PAGE.replace(' aria-modal="true"', '');
    shown();
    expect(modalInFront()).toBeNull();
    expect(behindModal(document.querySelector('main input')!)).toBe(false);
  });
});
