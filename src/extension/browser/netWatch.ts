/**
 * Runs in the page itself (its main world), like the leave guard: it sees the page's own fetch and XMLHttpRequest.
 * Self-contained — it is sent to the page as code.
 *
 * It notes the calls that change data (POST, PUT, PATCH, DELETE) and what the server answered, so the agent knows
 * whether a save worked and why not (“NHI already exists”), and the crawler can write which call each form makes.
 *
 * What is kept, and what is not (patient data is not stored):
 * - an answer that is an error (status 400+, or a body that says error / success: false): its message, clipped;
 * - an answer that worked: only its shape — the field names and kinds, never the values;
 * - what was sent: only the field names.
 * Analytics and error-reporting calls are left out.
 *
 * `install`: put the watch in place (once per page). `read`: the calls since a time (ms), and how many still wait for
 * their answer.
 */
export interface NetCall {
  /** When it was sent (page clock = Date.now()). */
  t: number;
  method: string;
  /** Address without its query values: `https://api.x.com/patients?search` */
  url: string;
  status: number;
  ok: boolean;
  /** The server's message when it refused (clipped), or the shape of what it sent back. */
  answer: string;
  /** The field names that were sent. */
  sent: string;
  ms: number;
}

export function NET_WATCH(op: string, since: number): unknown {
  type Watch = { calls: NetCall[]; pending: number[] };
  const w = window as Window & { __waNet?: Watch };
  if (op === 'read') {
    const st = w.__waNet;
    // Only calls this action made are waited for — not a long-poll the page keeps open all the time.
    return st ? { calls: st.calls.filter((c) => c.t >= since), inflight: st.pending.filter((t) => t >= since).length } : { calls: [], inflight: 0, missing: true };
  }
  if (w.__waNet) return true;
  const st: Watch = { calls: [], pending: [] };
  const done = (t: number) => {
    const i = st.pending.indexOf(t);
    if (i >= 0) st.pending.splice(i, 1);
  };
  w.__waNet = st;

  const CHANGES = /^(POST|PUT|PATCH|DELETE)$/i;
  const TELEMETRY = /(sentry|google-analytics|googletagmanager|analytics|segment\.(io|com)|mixpanel|hotjar|datadog|newrelic|nr-data|clarity\.ms|amplitude|intercom|fullstory|logrocket|bugsnag|rollbar|doubleclick|facebook\.com\/tr|\/collect\b|\/telemetry|\/beacon|\/metrics|\/log(s|ging)?\b)/i;
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

  const address = (raw: string): string => {
    try {
      const u = new URL(raw, location.href);
      const keys = [...new Set([...u.searchParams.keys()])];
      return `${u.origin === location.origin ? '' : u.origin}${u.pathname}${keys.length ? `?${keys.join('&')}` : ''}`;
    } catch {
      return clip(raw, 120);
    }
  };

  /** The kinds of a value, no values: {id, name, wing: {id, name}, tags: [{id}]}. */
  const shape = (v: unknown, depth = 0): string => {
    if (v === null || v === undefined) return 'null';
    if (Array.isArray(v)) return v.length ? `[${shape(v[0], depth + 1)}]` : '[]';
    if (typeof v === 'object') {
      if (depth >= 3) return '{…}';
      const keys = Object.keys(v as object).slice(0, 25);
      const parts = keys.map((k) => {
        const x = (v as Record<string, unknown>)[k];
        return x !== null && typeof x === 'object' ? `${k}: ${shape(x, depth + 1)}` : k;
      });
      return `{${parts.join(', ')}${Object.keys(v as object).length > 25 ? ', …' : ''}}`;
    }
    return typeof v;
  };

  const parse = (text: string): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  };

  /** What the server said when it refused: its own message fields, else the start of its body. */
  const refusal = (body: unknown, text: string): string => {
    if (body && typeof body === 'object') {
      const b = body as Record<string, unknown>;
      const said = ['message', 'error', 'errors', 'detail', 'title', 'description', 'msg', 'reason', 'validationErrors', 'fieldErrors']
        .filter((k) => b[k] !== undefined && b[k] !== null && b[k] !== '')
        .map((k) => `${k}: ${typeof b[k] === 'string' ? b[k] : JSON.stringify(b[k])}`);
      if (said.length) return clip(said.join('; '), 400);
    }
    return clip(text.replace(/\s+/g, ' ').trim(), 400);
  };

  const saysError = (body: unknown) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
    const b = body as Record<string, unknown>;
    return b.success === false || b.ok === false || (!!b.error && b.error !== false) || (Array.isArray(b.errors) && b.errors.length > 0);
  };

  const sentNames = (body: unknown): string => {
    if (body === null || body === undefined) return '';
    if (typeof body === 'string') {
      const j = parse(body);
      if (j && typeof j === 'object') return shape(j);
      if (body.includes('=') && !body.includes(' ')) return [...new URLSearchParams(body).keys()].join(', ');
      return 'text';
    }
    if (typeof FormData !== 'undefined' && body instanceof FormData) return [...new Set([...body.keys()])].join(', ');
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return [...new Set([...body.keys()])].join(', ');
    if (typeof Blob !== 'undefined' && body instanceof Blob) return `file (${body.type || 'binary'})`;
    return typeof body;
  };

  const note = (c: Omit<NetCall, 'ok' | 'answer'>, text: string) => {
    const body = parse(text);
    const failed = c.status >= 400 || c.status === 0 || saysError(body);
    const answer = failed ? refusal(body, text || `no answer (status ${c.status})`) : body !== undefined ? shape(body) : text ? `text (${text.length} chars)` : 'empty';
    st.calls.push({ ...c, ok: !failed, answer });
    if (st.calls.length > 60) st.calls.splice(0, st.calls.length - 60);
  };

  const watched = (method: string, url: string) => CHANGES.test(method) && !TELEMETRY.test(url);

  // fetch
  const realFetch = window.fetch;
  if (typeof realFetch === 'function') {
    window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const p = realFetch.call(this as typeof window, input, init);
      if (!watched(method, raw)) return p;
      const t = Date.now();
      const sent = sentNames(init?.body);
      st.pending.push(t);
      p.then(
        (res) => {
          res
            .clone()
            .text()
            .catch(() => '')
            .then((text) => note({ t, method, url: address(raw), status: res.status, sent, ms: Date.now() - t }, text))
            .finally(() => done(t));
        },
        (err: unknown) => {
          note({ t, method, url: address(raw), status: 0, sent, ms: Date.now() - t }, `network error: ${err instanceof Error ? err.message : String(err)}`);
          done(t);
        },
      );
      return p;
    } as typeof window.fetch;
  }

  // XMLHttpRequest
  const XHR = window.XMLHttpRequest?.prototype;
  if (XHR) {
    const open = XHR.open;
    const send = XHR.send;
    XHR.open = function (this: XMLHttpRequest & { __wa?: { method: string; url: string } }, method: string, url: string | URL, ...rest: unknown[]) {
      this.__wa = { method: String(method).toUpperCase(), url: String(url) };
      return (open as (...a: unknown[]) => void).call(this, method, url, ...rest);
    } as typeof XHR.open;
    XHR.send = function (this: XMLHttpRequest & { __wa?: { method: string; url: string } }, body?: Document | XMLHttpRequestBodyInit | null) {
      const meta = this.__wa;
      if (meta && watched(meta.method, meta.url)) {
        const t = Date.now();
        const sent = sentNames(body);
        st.pending.push(t);
        this.addEventListener(
          'loadend',
          () => {
            let text = '';
            try {
              text = this.responseType === '' || this.responseType === 'text' ? this.responseText : this.responseType === 'json' ? JSON.stringify(this.response) : '';
            } catch {
              text = '';
            }
            note({ t, method: meta.method, url: address(meta.url), status: this.status, sent, ms: Date.now() - t }, text);
            done(t);
          },
          { once: true },
        );
      }
      return send.call(this, body);
    };
  }
  return true;
}

/** One call as the agent and the knowledge read it: `POST /api/patients → 409 refused: message: NHI already exists (sent: firstName, nhi)`. */
export function describeCall(c: NetCall): string {
  const sent = c.sent && c.sent !== 'text' ? ` (sent: ${c.sent.length > 200 ? `${c.sent.slice(0, 199)}…` : c.sent})` : '';
  return c.ok ? `${c.method} ${c.url} → ${c.status} ok, answered ${c.answer}${sent}` : `${c.method} ${c.url} → ${c.status || 'failed'} refused: ${c.answer}${sent}`;
}
