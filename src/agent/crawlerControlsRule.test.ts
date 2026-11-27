import { describe, expect, it } from 'vitest';
import { mergedControls } from './crawler/risk';

const OLD = 'These controls delete, save, send or sign out — ask the user before clicking them: “Deactivate”, “/patients|reset”, “Sign out”.';

describe('Controls that change data: a short crawl adds, never shortens', () => {
  it('keeps the saved controls and adds the new ones', () => {
    expect(mergedControls(OLD, ['Book appointment', 'Reset'])).toEqual(['Deactivate', 'Reset', 'Sign out', 'Book appointment']);
  });
  it('proposes no update when nothing new was found', () => {
    expect(mergedControls(OLD, ['Reset', 'sign out'])).toBeNull();
  });
  it('a first crawl lists what it found', () => {
    expect(mergedControls(undefined, ['Save'])).toEqual(['Save']);
    expect(mergedControls(undefined, [])).toBeNull();
  });
});
