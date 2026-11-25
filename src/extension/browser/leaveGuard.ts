/**
 * Runs in the page itself (its main world), so it sees the page's own “Leave site?” handlers. Self-contained:
 * it is sent to the page as code.
 *
 * - `arm`: put the guard in place. A click on a link that would leave the page while the page has unsaved
 *   changes is held back (the browser's “Leave site?” dialog would stop the tab); the address is kept for `take`.
 * - `allow`: the page may be left — its “Leave site?” question is switched off from now on.
 * - `probe`: would leaving now ask “Leave site?” (the page has unsaved changes)?
 * - `take`: the held-back address, once.
 */
export function LEAVE_GUARD(op: string): unknown {
  type State = { allow: boolean; held: string | null; probing: boolean };
  const w = window as Window & { __waLeave?: State };
  const wouldAsk = (): boolean => {
    const st = w.__waLeave;
    if (st) st.probing = true;
    try {
      let ev: Event;
      let real = true;
      try {
        ev = document.createEvent('BeforeUnloadEvent');
        ev.initEvent('beforeunload', false, true);
      } catch {
        // No BeforeUnloadEvent here: a plain event still tells a handler that cancels it.
        ev = new Event('beforeunload', { cancelable: true });
        real = false;
      }
      window.dispatchEvent(ev);
      return ev.defaultPrevented || (real && !!(ev as BeforeUnloadEvent).returnValue);
    } catch {
      return false;
    } finally {
      if (st) st.probing = false;
    }
  };
  if (!w.__waLeave) {
    const st: State = { allow: false, held: null, probing: false };
    w.__waLeave = st;
    // At the window itself capturing listeners run first, so once allowed the page's own never see the event.
    window.addEventListener(
      'beforeunload',
      (e) => {
        if (st.allow && !st.probing) {
          e.stopImmediatePropagation();
          window.onbeforeunload = null;
        }
      },
      true,
    );
    // Last in line (the window, bubbling): an app that moves within itself has already prevented the default.
    window.addEventListener('click', (e) => {
      if (st.allow || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.hasAttribute('download') || (a.target && a.target !== '_self')) return;
      let to: URL;
      try {
        to = new URL(a.href, location.href);
      } catch {
        return;
      }
      if (!/^https?:$/.test(to.protocol)) return;
      if (to.origin === location.origin && to.pathname === location.pathname && to.search === location.search) return;
      if (!wouldAsk()) return;
      e.preventDefault();
      st.held = to.href;
    });
  }
  const st = w.__waLeave;
  if (op === 'allow') {
    st.allow = true;
    window.onbeforeunload = null;
    // Handlers the capturing listener can't stop (one the page added earlier with capture, one it sets again on
    // every change): what they do to the event is undone — no “Leave site?” however the page asks it.
    try {
      Object.defineProperty(window, 'onbeforeunload', { configurable: true, get: () => null, set: () => undefined });
    } catch {
      /* not configurable here */
    }
    const patched = w as Window & { __waLeavePatched?: boolean };
    if (!patched.__waLeavePatched) {
      patched.__waLeavePatched = true;
      const prevent = Event.prototype.preventDefault;
      Event.prototype.preventDefault = function (this: Event) {
        if (this.type === 'beforeunload' && st.allow && !st.probing) return;
        return prevent.call(this);
      };
      const proto = (window as Window & { BeforeUnloadEvent?: { prototype: object } }).BeforeUnloadEvent?.prototype;
      const rv = proto ? Object.getOwnPropertyDescriptor(proto, 'returnValue') : undefined;
      if (proto && rv?.set) {
        try {
          Object.defineProperty(proto, 'returnValue', {
            configurable: true,
            get: rv.get,
            set(this: object, v: unknown) {
              if (st.allow && !st.probing) return;
              rv.set!.call(this, v);
            },
          });
        } catch {
          /* left as it is */
        }
      }
    }
    return true;
  }
  if (op === 'probe') return !st.allow && wouldAsk();
  if (op === 'take') {
    const held = st.held;
    st.held = null;
    return held;
  }
  return true;
}
