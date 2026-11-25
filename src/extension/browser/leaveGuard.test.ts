// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { LEAVE_GUARD } from './leaveGuard';

describe('leave guard', () => {
  it('asks only when the page would ask, holds a leaving link, and lets go once allowed', () => {
    expect(LEAVE_GUARD('probe')).toBe(false);
    const ask = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'unsaved';
    };
    window.addEventListener('beforeunload', ask);
    expect(LEAVE_GUARD('probe')).toBe(true);

    const a = document.createElement('a');
    a.href = 'https://other.example/next';
    document.body.append(a);
    a.click();
    expect(LEAVE_GUARD('take')).toBe('https://other.example/next');
    expect(LEAVE_GUARD('take')).toBe(null);

    LEAVE_GUARD('allow');
    expect(LEAVE_GUARD('probe')).toBe(false);
    a.click();
    expect(LEAVE_GUARD('take')).toBe(null);
    window.removeEventListener('beforeunload', ask);
  });
});

describe('leave guard, once allowed', () => {
  it('a handler the page set first, or sets again, can no longer ask “Leave site?”', () => {
    const early = (e: Event) => e.preventDefault();
    window.addEventListener('beforeunload', early, true);
    LEAVE_GUARD('allow');
    window.onbeforeunload = () => 'unsaved';
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(window.onbeforeunload).toBe(null);
    window.removeEventListener('beforeunload', early, true);
  });
});
