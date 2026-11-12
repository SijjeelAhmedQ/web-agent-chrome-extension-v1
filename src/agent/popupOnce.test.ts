import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectInteractive } from '@/extension/content/elements';

describe('a pop-up’s controls are listed once', () => {
  afterEach(() => vi.restoreAllMocks());

  it('also when the pop-up is the last thing on the page (the Smart Inbox’s Attention Providers)', () => {
    // jsdom lays nothing out: every element gets a size, as on a real page.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, toJSON: () => ({}) } as DOMRect);
    Object.assign(HTMLElement.prototype, { checkVisibility: () => true });
    document.body.innerHTML = `<main><button>Attention Providers</button></main>
      <div class="portal"><div role="dialog"><input type="text" aria-label="Search provider by name">
        <button>Cancel</button><button>Assign</button></div></div>`;
    const names = collectInteractive().elements.map((el) => el.textContent?.trim() || el.getAttribute('aria-label'));
    expect(names).toEqual(['Search provider by name', 'Cancel', 'Assign', 'Attention Providers']);
  });
});
